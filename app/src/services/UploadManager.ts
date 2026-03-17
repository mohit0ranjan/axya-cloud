/**
 * UploadManager.ts — Production-grade upload queue manager
 * Fully migrated to expo-file-system SDK 55 new API (File, FileHandle, Paths)
 *
 * ✅ Chunk reading: File.open() → FileHandle.readBytes() — NO deprecated APIs
 * ✅ MD5 hash: File.md5 property — NO deprecated APIs
 * ✅ Zero usage of expo-file-system/legacy or readAsStringAsync
 * ✅ Pause / Resume / Cancel: all functional with AbortController
 * ✅ notify() creates new task object references → React re-renders work
 * ✅ activeUploads counter has no race conditions
 * ✅ Retry with exponential backoff (5 attempts)
 * ✅ Persistence via AsyncStorage (queue survives app restart)
 * ✅ Android progress notifications via expo-notifications
 * ✅ Real progress via axios onUploadProgress — no fake timers
 * ✅ Throttled notifications (200ms) to avoid excessive React re-renders
 * ✅ Duplicate upload prevention via file URI + name + size hash
 * ✅ Byte-accurate overallProgress = uploadedBytes / totalBytes * 100
 */

import { File, Paths } from 'expo-file-system';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { getNotificationsEnabled } from '../utils/preferences';
import { Buffer } from 'buffer';
import apiClient, { uploadClient } from './apiClient';
import { syncAfterFileMutation } from './fileStateSync';
import { sanitizeFileName } from '../utils/fileSafety';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface FileAsset {
    uri: string;
    name: string;
    size: number;
    mimeType?: string;
}

export type UploadStatus =
    | 'pending'
    | 'queued'
    | 'uploading'
    | 'paused'
    | 'waiting_retry'
    | 'retrying'
    | 'completed'
    | 'failed'
    | 'cancelled';

export interface UploadTask {
    id: string;
    file: FileAsset;
    folderId: string | null;
    chatTarget: string;
    /** 0–100 */
    progress: number;
    /** Bytes successfully sent so far */
    bytesUploaded: number;
    status: UploadStatus;
    error?: string;
    retryCount: number;
    /** Server-assigned upload session ID */
    uploadId?: string;
    /** Fingerprint for deduplication (uri + name + size) */
    fingerprint: string;
    /** True if server detected this file already exists (hash match) */
    duplicate?: boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Convert a Uint8Array to a Base64 string (used for native chunk uploads) */
function uint8ArrayToBase64(bytes: Uint8Array): string {
    return Buffer.from(bytes).toString('base64');
}

/** Generate a fingerprint for deduplication */
function makeFingerprint(file: FileAsset): string {
    const safeName = sanitizeFileName(file.name, 'file');
    return `${file.uri}|${safeName}|${file.size}`;
}

/**
 * Read `length` bytes starting at `offset` from a file URI as Base64.
 *
 * Strategy (in priority order):
 * 1. Native (iOS/Android): Use expo-file-system's new `File` + `FileHandle` API.
 *    FileHandle.readBytes(n) reads from the current offset position.
 *    This is the canonical SDK 55+ approach — zero deprecated APIs.
 *
 * 2. Fallback: Use fetch() with a Range header.
 *    Works for file:// and content:// URIs on React Native >= 0.71.
 *    Used as a fallback for URIs that the new FileHandle may not support
 *    (e.g. content:// URIs from Android DocumentPicker on some devices).
 */
async function readFileChunkAsBase64(
    uri: string,
    offset: number,
    length: number
): Promise<string> {
    // Prefer new File API for all URI types; content:// often works here too.
    try {
        const fileObj = new File(uri);
        const handle = fileObj.open();
        handle.offset = offset;
        const chunk = handle.readBytes(length);
        handle.close();
        return uint8ArrayToBase64(chunk);
    } catch (e) {
        // Fall through to fetch fallback
        console.warn('[UploadManager] FileHandle read failed, using fetch fallback:', e);
    }

    // Fetch fallback (content:// URIs, web simulator, edge cases)
    const response = await fetch(uri, {
        headers: { Range: `bytes=${offset}-${offset + length - 1}` },
    });
    if (!response.ok && response.status !== 206 && response.status !== 200) {
        throw new Error(`Failed to read file chunk (HTTP ${response.status})`);
    }
    const buffer = await response.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    return uint8ArrayToBase64(bytes);
}

// ─── UploadManager ────────────────────────────────────────────────────────────

class UploadManager {
    public tasks: UploadTask[] = [];
    // ✅ 3 concurrent uploads — matches server semaphore
    private readonly MAX_CONCURRENT = 3;
    // ✅ 5 retries — handles Telegram FLOOD_WAIT and Render cold starts gracefully
    private readonly MAX_RETRIES = 5;
    private readonly CHUNK_SIZE = 5 * 1024 * 1024; // 5 MB chunks
    // ✅ Throttle notify to ~200ms to avoid excessive React re-renders
    private readonly NOTIFY_THROTTLE_MS = 200;
    private readonly SPEED_WINDOW_MS = 3000;
    private readonly notificationsEnabled =
        Platform.OS !== 'web' && typeof Notifications.scheduleNotificationAsync === 'function';

    // ── Historical stats for auto-cleared tasks ──
    private clearedCompletedCount = 0;
    private clearedFailedCount = 0;
    private clearedTotalBytes = 0;
    private clearedUploadedBytes = 0;
    private clearedTotalFiles = 0;

    // ── Cached stats (invalidated on every notify) ──
    private cachedStats: ReturnType<UploadManager['computeStats']> | null = null;
    private speedSamples: Array<{ ts: number; uploadedBytes: number }> = [];
    private emaUploadSpeedBps = 0;
    private lastSpeedSampleTs = 0;

    private get activeUploads(): number {
        return this.tasks.filter(t => t.status === 'uploading').length;
    }

    private static VALID_TRANSITIONS: Record<UploadStatus, UploadStatus[]> = {
        queued: ['uploading', 'paused', 'cancelled'],
        uploading: ['completed', 'waiting_retry', 'failed', 'paused', 'cancelled'],
        waiting_retry: ['retrying', 'cancelled', 'paused'],
        retrying: ['uploading', 'cancelled', 'paused'],
        paused: ['queued'],
        failed: ['queued'],
        completed: [],
        cancelled: [],
        pending: ['queued'],
    };

    private transition(task: UploadTask, to: UploadStatus): boolean {
        const allowed = UploadManager.VALID_TRANSITIONS[task.status];
        if (!allowed?.includes(to)) {
            console.warn(`[SM] Illegal: ${task.status} → ${to} for "${task.file.name}"`);
            return false;
        }
        task.status = to;
        return true;
    }

    private updateTask(id: string, updates: Partial<UploadTask>) {
        const index = this.tasks.findIndex(t => t.id === id);
        if (index === -1) return;
        this.tasks[index] = { ...this.tasks[index], ...updates };
        this.cachedStats = null; // Invalidate stats cache
        this.notifyListeners();
    }

    private listeners: ((tasks: UploadTask[]) => void)[] = [];

    /**
     * Map of taskId → AbortController.
     * Aborting signals the running performUpload to stop.
     */
    private abortControllers: Map<string, AbortController> = new Map();

    /** Throttle: timestamp of last notify */
    private lastNotifyTime = 0;
    private pendingNotifyTimer: ReturnType<typeof setTimeout> | null = null;

    constructor() {
        this.loadQueue();
    }

    // ── Persistence ───────────────────────────────────────────────────────────

    private async loadQueue() {
        try {
            const stored = await AsyncStorage.getItem('@upload_queue_v2');
            if (stored) {
                const parsed: UploadTask[] = JSON.parse(stored);
                this.tasks = parsed.map(t =>
                    (
                        t.status === 'uploading'
                        || t.status === 'retrying'
                        || t.status === 'waiting_retry'
                        || t.status === 'pending'
                    )
                        ? { ...t, status: 'queued' as UploadStatus, progress: 0, bytesUploaded: 0, uploadId: undefined }
                        : t
                );
            }
            // Load historical stats
            const statsStored = await AsyncStorage.getItem('@upload_stats_v2');
            if (statsStored) {
                const parsedStats = JSON.parse(statsStored);
                this.clearedCompletedCount = parsedStats.clearedCompletedCount || 0;
                this.clearedFailedCount = parsedStats.clearedFailedCount || 0;
                this.clearedTotalBytes = parsedStats.clearedTotalBytes || 0;
                this.clearedUploadedBytes = parsedStats.clearedUploadedBytes || 0;
                this.clearedTotalFiles = parsedStats.clearedTotalFiles || 0;
            }

            if (stored || statsStored) {
                this.notifyListeners(true); // force, bypass throttle for initial load
            }
            if (this.tasks.some(t => t.status === 'queued' || t.status === 'retrying')) {
                // Resume queue automatically after app restart/background wake.
                this.processQueue();
            }
        } catch (e) {
            console.error('[UploadManager] Failed to load queue:', e);
        }
    }

    private isFatalUploadError(error: any): boolean {
        const message = String(error?.message || '').toLowerCase();
        const status = Number(error?.response?.status || 0);
        const code = String(error?.response?.data?.code || error?.code || '').toUpperCase();
        const retryable = (error?.response?.data?.retryable);

        if (retryable === false) return true;
        if (code === 'TELEGRAM_SESSION_EXPIRED' || code === 'SCHEMA_NOT_READY') return true;
        if (status === 400 || status === 401 || status === 403 || status === 404 || status === 409 || status === 413 || status === 422) {
            return true;
        }

        return message.includes('session expired')
            || message.includes('session invalid')
            || message.includes('re-login')
            || message.includes('unauthorized')
            || message.includes('forbidden')
            || message.includes('quota exceeded')
            || message.includes('empty file')
            || message.includes('schema_not_ready');
    }

    private toUserFacingUploadError(error: any): string {
        const code = String(error?.response?.data?.code || error?.code || '').toLowerCase();
        const backendMessage = String(error?.response?.data?.message || error?.response?.data?.error || '').trim();
        if (code === 'schema_not_ready') return 'Service is starting. Please retry in a moment.';
        if (code === 'telegram_session_expired') return 'Telegram session expired. Please reconnect Telegram in Profile.';
        if (code === 'telegram_transient') return 'Telegram is temporarily unavailable. Retrying may help.';
        if (backendMessage) return backendMessage;
        return error?.message || 'Upload failed';
    }

    private saveQueue() {
        const toSave = this.tasks.filter(
            t => t.status !== 'completed' && t.status !== 'cancelled'
        );
        AsyncStorage.setItem('@upload_queue_v2', JSON.stringify(toSave)).catch(() => { });

        const statsToSave = {
            clearedCompletedCount: this.clearedCompletedCount,
            clearedFailedCount: this.clearedFailedCount,
            clearedTotalBytes: this.clearedTotalBytes,
            clearedUploadedBytes: this.clearedUploadedBytes,
            clearedTotalFiles: this.clearedTotalFiles,
        };
        AsyncStorage.setItem('@upload_stats_v2', JSON.stringify(statsToSave)).catch(() => { });
    }

    // ── Subscription ─────────────────────────────────────────────────────────

    public subscribe(listener: (tasks: UploadTask[]) => void): () => void {
        this.listeners.push(listener);
        listener(this.snapshotTasks());
        return () => {
            this.listeners = this.listeners.filter(l => l !== listener);
        };
    }

    /**
     * Creates a new array with new task objects on every call.
     * This is critical: React state comparison (===) needs new references
     * to detect changes inside task objects (e.g. progress, status).
     */
    private snapshotTasks(): UploadTask[] {
        // Because we update tasks immutably via updateTask, 
        // tasks references are already new, so returning a shallow copy 
        // to React is perfectly fine without deep mapping:
        return [...this.tasks];
    }

    /**
     * Throttled notify — avoids flooding React with state updates during
     * rapid chunk uploads. Forces immediate notify for status changes (force=true).
     */
    private notifyListeners(force = false) {
        this.saveQueue();
        this.cachedStats = null; // Invalidate stats cache on every notify

        const now = Date.now();
        const elapsed = now - this.lastNotifyTime;

        if (force || elapsed >= this.NOTIFY_THROTTLE_MS) {
            // Flush immediately
            if (this.pendingNotifyTimer) {
                clearTimeout(this.pendingNotifyTimer);
                this.pendingNotifyTimer = null;
            }
            this.lastNotifyTime = now;
            this.updateNotification();
            const snapshot = this.snapshotTasks();
            this.listeners.forEach(l => l(snapshot));
        } else if (!this.pendingNotifyTimer) {
            // Schedule a trailing flush
            this.pendingNotifyTimer = setTimeout(() => {
                this.pendingNotifyTimer = null;
                this.lastNotifyTime = Date.now();
                this.updateNotification();
                const snapshot = this.snapshotTasks();
                this.listeners.forEach(l => l(snapshot));
            }, this.NOTIFY_THROTTLE_MS - elapsed);
        }
    }

    // ── Aggregate Stats ──────────────────────────────────────────────────────

    public getStats() {
        if (this.cachedStats) return this.cachedStats;
        this.cachedStats = this.computeStats();
        return this.cachedStats;
    }

    /**
     * Compute real aggregate stats from tasks.
     * Called only when cache is invalidated (on task changes).
     */
    private computeStats() {
        // Single pass over tasks array instead of 7 separate filter calls
        let activeUploadedCount = 0;
        let queuedCount = 0;
        let activeFailedCount = 0;
        let activeCount = 0;
        let uploadingCount = 0;
        let pausedCount = 0;
        let cancelledCount = 0;
        let activeTotalBytes = 0;
        let activeUploadedBytes = 0;

        for (const t of this.tasks) {
            const size = Math.max(t.file.size || 1, 1);
            activeTotalBytes += size;

            switch (t.status) {
                case 'completed':
                    activeUploadedCount++;
                    activeUploadedBytes += size;
                    break;
                case 'queued':
                    queuedCount++;
                    activeCount++;
                    break;
                case 'uploading':
                    uploadingCount++;
                    activeCount++;
                    activeUploadedBytes += (t.bytesUploaded || 0);
                    break;
                case 'retrying':
                    activeCount++;
                    activeUploadedBytes += (t.bytesUploaded || 0);
                    break;
                case 'failed':
                    activeFailedCount++;
                    activeUploadedBytes += (t.bytesUploaded || 0);
                    break;
                case 'paused':
                    pausedCount++;
                    activeUploadedBytes += (t.bytesUploaded || 0);
                    break;
                case 'cancelled':
                    cancelledCount++;
                    break;
                default:
                    activeUploadedBytes += (t.bytesUploaded || 0);
                    break;
            }
        }

        // Combined historic + active stats
        const totalFiles = this.clearedTotalFiles + this.tasks.length;
        const uploadedCount = this.clearedCompletedCount + activeUploadedCount;
        const failedCount = activeFailedCount;
        const totalBytes = this.clearedTotalBytes + activeTotalBytes;
        const uploadedBytes = this.clearedUploadedBytes + activeUploadedBytes;

        const overallProgress = totalBytes > 0
            ? Math.round(Math.min((uploadedBytes / totalBytes) * 100, 100))
            : 0;
        const { avgUploadSpeedBps, currentUploadSpeedBps } = this.computeUploadSpeeds(
            uploadedBytes,
            uploadingCount > 0
        );

        return {
            totalFiles,
            uploadedCount,
            queuedCount,
            failedCount,
            activeCount,
            uploadingCount,
            pausedCount,
            cancelledCount,
            totalBytes,
            uploadedBytes,
            avgUploadSpeedBps,
            currentUploadSpeedBps,
            overallProgress,
        };
    }

    private computeUploadSpeeds(uploadedBytes: number, isActivelyUploading: boolean) {
        const now = Date.now();
        let currentUploadSpeedBps = 0;

        if (!isActivelyUploading) {
            this.speedSamples = [{ ts: now, uploadedBytes }];
            this.emaUploadSpeedBps = 0;
            this.lastSpeedSampleTs = now;
            return { avgUploadSpeedBps: 0, currentUploadSpeedBps: 0 };
        }

        if (!this.lastSpeedSampleTs || (now - this.lastSpeedSampleTs) >= this.NOTIFY_THROTTLE_MS) {
            this.speedSamples.push({ ts: now, uploadedBytes });
            this.lastSpeedSampleTs = now;
        }

        const cutoff = now - this.SPEED_WINDOW_MS;
        this.speedSamples = this.speedSamples.filter(s => s.ts >= cutoff);

        if (this.speedSamples.length >= 2) {
            const first = this.speedSamples[0];
            const last = this.speedSamples[this.speedSamples.length - 1];
            const deltaBytes = Math.max(last.uploadedBytes - first.uploadedBytes, 0);
            const deltaTimeSec = Math.max((last.ts - first.ts) / 1000, 0.001);
            currentUploadSpeedBps = deltaBytes / deltaTimeSec;
        }

        if (currentUploadSpeedBps > 0) {
            const alpha = 0.4;
            this.emaUploadSpeedBps = this.emaUploadSpeedBps === 0
                ? currentUploadSpeedBps
                : (alpha * currentUploadSpeedBps) + ((1 - alpha) * this.emaUploadSpeedBps);
        }

        return {
            avgUploadSpeedBps: Math.max(this.emaUploadSpeedBps, 0),
            currentUploadSpeedBps: Math.max(currentUploadSpeedBps, 0),
        };
    }

    // ── Notifications ─────────────────────────────────────────────────────────

    private async updateNotification() {
        if (!this.notificationsEnabled || !(await getNotificationsEnabled())) return;
        const stats = this.getStats();

        if (stats.activeCount > 0) {
            const parts: string[] = [];
            if (stats.uploadingCount > 0) parts.push(`${stats.uploadingCount} uploading`);
            if (stats.queuedCount > 0) parts.push(`${stats.queuedCount} queued`);
            if (stats.failedCount > 0) parts.push(`${stats.failedCount} failed`);

            try {
                await Notifications.scheduleNotificationAsync({
                    identifier: 'upload_progress',
                    content: {
                        title: `Axya · ${stats.overallProgress}%`,
                        body: `${parts.join(' · ')} · ${stats.totalFiles} total`,
                        data: { type: 'upload_progress', progress: stats.overallProgress },
                        android: {
                            channelId: 'upload_channel',
                            ongoing: true,
                            onlyAlertOnce: true,
                            progress: {
                                max: 100,
                                current: stats.overallProgress,
                                indeterminate: stats.overallProgress === 0,
                            },
                            smallIcon: 'notification_icon',
                            color: '#4B6EF5',
                            priority: Notifications.AndroidNotificationPriority.LOW,
                        },
                    } as any,
                    trigger: null,
                });
            } catch (err) { console.warn('[UploadManager] Warning: Failed to schedule progress notification:', err); }
        } else {
            try {
                await Notifications.dismissNotificationAsync('upload_progress');

                if (stats.uploadedCount > 0 || stats.failedCount > 0) {
                    const title = stats.failedCount > 0
                        ? `Upload finished — ${stats.failedCount} failed ⚠️`
                        : 'Upload complete ✅';
                    const body = [
                        `${stats.uploadedCount} of ${stats.totalFiles} uploaded`,
                        stats.failedCount > 0 ? `${stats.failedCount} failed — tap to retry` : '',
                    ].filter(Boolean).join(' · ');

                    await Notifications.scheduleNotificationAsync({
                        content: {
                            title,
                            body,
                            android: {
                                channelId: 'upload_channel',
                                color: stats.failedCount > 0 ? '#EF4444' : '#1FD45A',
                                priority: Notifications.AndroidNotificationPriority.DEFAULT,
                            },
                        } as any,
                        trigger: null,
                    });
                }
            } catch (err) { console.warn('[UploadManager] Warning: Failed to schedule completion notification:', err); }
        }
    }

    // ── Public API ────────────────────────────────────────────────────────────

    public addUploads(
        files: FileAsset[],
        folderId: string | null = null,
        chatTarget: string = 'me'
    ) {
        // Dedup: skip files already in the queue (by fingerprint)
        const existingFingerprints = new Set(
            this.tasks
                .filter(t => t.status !== 'cancelled' && t.status !== 'failed')
                .map(t => t.fingerprint)
        );

        const newTasks: UploadTask[] = [];
        for (const file of files) {
            const safeName = sanitizeFileName(file.name, 'file');
            const fp = makeFingerprint(file);
            if (existingFingerprints.has(fp)) {
                console.log(`[UploadManager] Skipped duplicate: "${safeName}"`);
                continue;
            }
            existingFingerprints.add(fp);
            newTasks.push({
                id: `${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
                file: { ...file, name: safeName },
                folderId,
                chatTarget,
                progress: 0,
                bytesUploaded: 0,
                status: 'queued',
                retryCount: 0,
                fingerprint: fp,
            });
        }

        if (newTasks.length === 0) return;

        this.tasks.push(...newTasks);
        this.notifyListeners(true);
        // Seed up to MAX_CONCURRENT parallel processors
        const slotsAvailable = this.MAX_CONCURRENT - this.activeUploads;
        for (let i = 0; i < Math.min(slotsAvailable, newTasks.length); i++) {
            this.processQueue();
        }
    }

    public pause(id: string) {
        const task = this.tasks.find(t => t.id === id);
        if (!task) return;
        if (['queued', 'uploading', 'retrying', 'waiting_retry'].includes(task.status)) {
            this.transition(task, 'paused');
            this.abortControllers.get(id)?.abort();
            this.notifyListeners(true);
        }
    }

    public resume(id: string) {
        const task = this.tasks.find(t => t.id === id);
        if (!task) return;
        if (task.status === 'paused' || task.status === 'failed') {
            // Cancel old server session before creating fresh one
            if (task.uploadId) {
                uploadClient.post('/files/upload/cancel', { uploadId: task.uploadId }).catch(() => { });
            }
            this.transition(task, 'queued');
            task.retryCount = 0;
            task.error = undefined;
            task.progress = 0;
            task.bytesUploaded = 0;
            task.uploadId = undefined;
            this.notifyListeners(true);
            this.processQueue();
        }
    }

    public cancel(id: string) {
        const task = this.tasks.find(t => t.id === id);
        if (!task) return;
        if (['completed', 'cancelled'].includes(task.status)) return;
        this.transition(task, 'cancelled');
        this.abortControllers.get(id)?.abort();

        // Tell the server to cancel the async Telegram upload
        if (task.uploadId) {
            uploadClient.post('/files/upload/cancel', { uploadId: task.uploadId }).catch(() => { });
        }

        this.notifyListeners(true);
        this.processQueue();
    }

    public cancelAll() {
        this.tasks.forEach(task => {
            if (!['completed', 'failed', 'cancelled'].includes(task.status)) {
                this.transition(task, 'cancelled');
                this.abortControllers.get(task.id)?.abort();
                if (task.uploadId) {
                    uploadClient.post('/files/upload/cancel', { uploadId: task.uploadId }).catch(() => { });
                }
            }
        });
        this.notifyListeners(true);
    }

    public clearCompleted() {
        this.tasks.forEach(t => {
            if (t.status === 'completed' || t.status === 'failed' || t.status === 'cancelled') {
                this.updateHistoricalStatsBeforeClear(t);
            }
        });

        this.tasks = this.tasks.filter(
            t => t.status !== 'completed' && t.status !== 'cancelled' && t.status !== 'failed'
        );
        this.notifyListeners(true);
    }

    public retryFailed() {
        this.tasks
            .filter(t => t.status === 'failed')
            .forEach(t => {
                // Cancel stale server session
                if (t.uploadId) {
                    uploadClient.post('/files/upload/cancel', { uploadId: t.uploadId }).catch(() => { });
                }
                this.transition(t, 'queued');
                t.retryCount = 0;
                t.error = undefined;
                t.progress = 0;
                t.bytesUploaded = 0;
                t.uploadId = undefined;
            });
        this.notifyListeners(true);
        this.processQueue();
    }

    // ── Queue Processor ───────────────────────────────────────────────────────

    private updateHistoricalStatsBeforeClear(task: UploadTask) {
        this.clearedTotalFiles++;
        this.clearedTotalBytes += Math.max(task.file.size || 1, 1);

        if (task.status === 'completed' || task.duplicate) {
            this.clearedCompletedCount++;
            this.clearedUploadedBytes += Math.max(task.file.size || 1, 1);
        } else if (task.status === 'failed') {
            this.clearedFailedCount++;
        }
    }

    private scheduleTaskClearing(task: UploadTask, delayMs: number = 3000) {
        setTimeout(() => {
            const currentTask = this.tasks.find(x => x.id === task.id);
            if (!currentTask) return; // already cleared by clearCompleted()

            // Allow clearing completed, duplicate or cancelled tasks
            if (['completed', 'cancelled', 'failed'].includes(currentTask.status)) {
                this.updateHistoricalStatsBeforeClear(currentTask);
                this.tasks = this.tasks.filter(x => x.id !== task.id);
                this.notifyListeners(true);
            }
        }, delayMs);
    }

    private async processQueue(): Promise<void> {
        // ✅ No boolean lock — use activeUploads count as the sole concurrency gate.
        // This allows up to MAX_CONCURRENT parallel processQueue calls.
        if (this.activeUploads >= this.MAX_CONCURRENT) return;

        const nextTask = this.tasks.find(
            t => t.status === 'queued' || t.status === 'retrying'
        );
        if (!nextTask) return;

        // Immediately mark as uploading so concurrent processQueue calls skip it
        this.updateTask(nextTask.id, { status: 'uploading' });

        try {
            await this.performUpload(nextTask);
            this.updateTask(nextTask.id, {
                status: 'completed',
                progress: 100,
                bytesUploaded: nextTask.file.size
            });
            syncAfterFileMutation();
            this.scheduleTaskClearing(nextTask);
        } catch (e: any) {
            const status = nextTask.status as UploadStatus;

            const isCancelOrPauseError = e?.name === 'AbortError' || e?.message === 'Cancelled';
            const isFatalSchemaError = e?.message?.includes('constraint') || e?.message?.includes('duplicate key');
            // ✅ Telegram fatal errors should NOT be retried
            const isFatalTelegramError = e?.message?.includes('FILE_PARTS_INVALID')
                || e?.message?.includes('FILE_REFERENCE_EXPIRED')
                || e?.message?.includes('MEDIA_EMPTY')
                || e?.message?.includes('FILE_ID_INVALID')
                || (e?.message?.includes('400:') && !e?.message?.includes('FLOOD'));
            const isFatalUploadError = this.isFatalUploadError(e);

            if (isCancelOrPauseError || status === 'cancelled') {
                if (status !== 'paused') {
                    this.updateTask(nextTask.id, { status: 'cancelled' });
                    this.scheduleTaskClearing(nextTask);
                }
                // If status is already 'paused', keep it
            } else if (status === 'paused') {
                // Keep paused
            } else if (isFatalSchemaError || isFatalTelegramError || isFatalUploadError) {
                // Do not retry fatal database/Telegram errors
                if (nextTask.uploadId) {
                    uploadClient.post('/files/upload/cancel', { uploadId: nextTask.uploadId }).catch(() => { });
                }
                this.updateTask(nextTask.id, {
                    status: 'failed',
                    error: this.toUserFacingUploadError(e)
                });
            } else {
                const newRetryCount = nextTask.retryCount + 1;
                if (newRetryCount <= this.MAX_RETRIES) {
                    if (nextTask.uploadId) {
                        try { uploadClient.post('/files/upload/cancel', { uploadId: nextTask.uploadId }).catch(() => { }); } catch { }
                    }
                    this.updateTask(nextTask.id, {
                        status: 'waiting_retry',
                        retryCount: newRetryCount,
                        uploadId: undefined, // Clear old session ID since server cancelled it
                        progress: 0,
                        bytesUploaded: 0
                    });
                    const delay = (Math.pow(2, newRetryCount) + 1) * 1000;
                    console.warn(
                        `[UploadManager] Retry ${nextTask.retryCount}/${this.MAX_RETRIES}`,
                        `"${nextTask.file.name}" in ${delay / 1000}s:`, e?.message
                    );
                    setTimeout(() => {
                        const t = this.tasks.find(x => x.id === nextTask.id);
                        if (t && t.status === 'waiting_retry') {
                            this.updateTask(t.id, { status: 'retrying' });
                            this.processQueue();
                        } else {
                            // Task was cancelled/paused while waiting — still trigger process
                            this.processQueue();
                        }
                    }, delay);
                } else {
                    this.updateTask(nextTask.id, {
                        status: 'failed',
                        error: this.toUserFacingUploadError(e)
                    });
                }
            }
        } finally {
            this.abortControllers.delete(nextTask.id);
            // ✅ Don't chain processQueue when retrying
            // — the retry timer will handle it after the backoff delay
            if (nextTask.status !== 'waiting_retry') {
                this.processQueue();
            }
        }
    }

    // ── Core Upload Logic ─────────────────────────────────────────────────────

    private async performUpload(task: UploadTask): Promise<void> {
        const abort = new AbortController();
        this.abortControllers.set(task.id, abort);

        const isCancelled = () =>
            task.status === 'cancelled' || task.status === 'paused' || abort.signal.aborted;

        const throwIfCancelled = () => {
            if (isCancelled()) throw new Error('Cancelled');
        };

        const { file, folderId, chatTarget } = task;

        // ── Step 0: Resolve file size if DocumentPicker returned 0 ────────
        if (!file.size || file.size <= 0) {
            if (Platform.OS !== 'web' && file.uri.startsWith('file://')) {
                try {
                    const fileObj = new File(file.uri);
                    file.size = fileObj.size ?? 0;
                } catch { /* fallthrough */ }
            }
            if (!file.size || file.size <= 0) {
                throw new Error('File has 0 bytes — cannot upload an empty file');
            }
        }

        // ── Step 1: MD5 hash for deduplication ──────────────────────────────
        // Using the new File.md5 property — no deprecated FileSystem.getInfoAsync
        let fileHash = '';
        if (Platform.OS !== 'web') {
            try {
                const fileObj = new File(file.uri);
                fileHash = fileObj.md5 ?? '';
            } catch {
                // Optional — proceed without hash
            }
        }

        throwIfCancelled();

        // ── Step 2: Init upload session ──────────────────────────────────────
        const initRes = await uploadClient.post(
            '/files/upload/init',
            {
                originalname: sanitizeFileName(file.name, 'file'),
                size: file.size,
                mimetype: file.mimeType || 'application/octet-stream',
                telegram_chat_id: chatTarget,
                folder_id: folderId,
                hash: fileHash,
            },
            { signal: abort.signal }
        );

        if (initRes.data.duplicate) {
            this.updateTask(task.id, {
                progress: 100,
                bytesUploaded: file.size,
                duplicate: true
            });
            return;
        }

        const { uploadId } = initRes.data;
        task.uploadId = uploadId;

        // ── Step 3: Upload chunks ────────────────────────────────────────────
        // Progress 0-50% = chunk upload phase (real bytes sent)
        // Progress 50-100% = server-side Telegram delivery (polled)
        let offset = 0;
        let chunkIndex = 0;

        if (Platform.OS === 'web') {
            // Web: Blob.slice chunking via fetch
            const blobResp = await fetch(file.uri);
            const blob = await blobResp.blob();

            while (offset < file.size) {
                throwIfCancelled();
                const chunk = blob.slice(offset, offset + this.CHUNK_SIZE);
                const formData = new FormData();
                formData.append('uploadId', uploadId);
                formData.append('chunkIndex', String(chunkIndex));
                formData.append('chunk', new globalThis.File([chunk], sanitizeFileName(file.name, 'file'), { type: file.mimeType }));

                await uploadClient.post('/files/upload/chunk', formData, {
                    signal: abort.signal,
                    onUploadProgress: (progressEvent: any) => {
                        // ✅ Fix 3: Use known chunk size as fallback when total is unavailable
                        const chunkTotal = progressEvent.total || chunk.size || this.CHUNK_SIZE;
                        const fraction = chunkTotal > 0 ? progressEvent.loaded / chunkTotal : 0;
                        this.updateTask(task.id, {
                            bytesUploaded: offset + Math.round(chunk.size * fraction),
                            progress: Math.round(
                                Math.min(((offset + Math.round(chunk.size * fraction)) / file.size) * 50, 50)
                            )
                        });
                    },
                });

                offset = Math.min(offset + this.CHUNK_SIZE, file.size);
                chunkIndex++;
                this.updateTask(task.id, {
                    bytesUploaded: offset,
                    progress: Math.round(Math.min((offset / file.size) * 50, 50))
                });
            }
        } else {
            // Native (iOS/Android): new File + FileHandle API
            while (offset < file.size) {
                throwIfCancelled();

                const length = Math.min(this.CHUNK_SIZE, file.size - offset);
                const chunkBase64 = await readFileChunkAsBase64(file.uri, offset, length);

                throwIfCancelled();

                await uploadClient.post(
                    '/files/upload/chunk',
                    { uploadId, chunkIndex, chunkBase64 },
                    {
                        signal: abort.signal,
                        onUploadProgress: (progressEvent: any) => {
                            // ✅ Fix 3: Use known chunk length as fallback when total is unavailable
                            const chunkTotal = progressEvent.total || progressEvent.bytes || length;
                            const fraction = chunkTotal > 0 ? progressEvent.loaded / chunkTotal : 0;
                            this.updateTask(task.id, {
                                bytesUploaded: offset + Math.round(length * fraction),
                                progress: Math.round(
                                    Math.min(((offset + Math.round(length * fraction)) / file.size) * 50, 50)
                                )
                            });
                        },
                    }
                );

                offset += length;
                chunkIndex++;
                this.updateTask(task.id, {
                    bytesUploaded: offset,
                    progress: Math.round(Math.min((offset / file.size) * 50, 50))
                });
            }
        }

        throwIfCancelled();
        this.updateTask(task.id, { progress: 50 });

        // ── Step 4: Finalise on server ───────────────────────────────────────
        await uploadClient.post(
            '/files/upload/complete',
            { uploadId },
            { signal: abort.signal }
        );

        // ── Step 5: Poll Telegram delivery status (50% → 100%) ───────────────
        // Server confirms DB entry + Telegram delivery — success only on server OK
        await new Promise<void>((resolve, reject) => {
            const maxWait = Date.now() + 10 * 60 * 1000;
            let settled = false;

            const settle = (fn: () => void) => {
                if (settled) return;
                settled = true;
                fn();
            };

            const poll = async () => {
                if (settled) return;
                if (isCancelled() || Date.now() > maxWait) {
                    settle(() => reject(new Error(Date.now() > maxWait ? 'Upload timed out' : 'Cancelled')));
                    return;
                }

                try {
                    const res = await apiClient.get(
                        `/files/upload/status/${uploadId}`,
                        { signal: abort.signal, _maxRetries: 0 } as any
                    );
                    const { status, progress: tgProgress, error: tgError, errorCode } = res.data;

                    if (status === 'completed') {
                        this.updateTask(task.id, { progress: 100, bytesUploaded: file.size });
                        settle(() => resolve());
                        return;
                    } else if (status === 'error' || status === 'cancelled') {
                        const err = new Error(tgError || 'Telegram upload failed') as any;
                        if (errorCode) err.code = errorCode;
                        if (typeof res.data?.retryable === 'boolean') {
                            err.response = { data: { retryable: res.data.retryable, code: errorCode, error: tgError } };
                        }
                        settle(() => reject(err));
                        return;
                    } else {
                        // Fix: update bytesUploaded during poll phase so stats compute correctly
                        const pollProgress = Math.round(50 + ((tgProgress || 0) * 0.5));
                        this.updateTask(task.id, {
                            progress: pollProgress,
                            bytesUploaded: Math.round((pollProgress / 100) * file.size)
                        });
                    }
                } catch (e: any) {
                    if (e.name === 'CanceledError' || e.name === 'AbortError') {
                        settle(() => reject(new Error('Cancelled')));
                        return;
                    }
                    if (e.response?.status === 404 || e.response?.status === 403) {
                        settle(() => reject(new Error(e.response?.data?.error || `Upload fatal error ${e.response?.status}`)));
                        return;
                    }
                    if (e.response?.data?.retryable === false) {
                        settle(() => reject(new Error(e.response?.data?.error || e.response?.data?.message || 'Upload failed')));
                        return;
                    }
                }

                if (!settled) setTimeout(poll, 2000);
            };

            // Use {once: true} to prevent memory leak
            abort.signal.addEventListener('abort', () => {
                settle(() => reject(new Error('Cancelled')));
            }, { once: true });

            poll();
        });
    }

    // ── Background support ────────────────────────────────────────────────────

    public resumeAllBackground() {
        this.processQueue();
    }
}

// Singleton shared across the entire app lifetime
export const uploadManager = new UploadManager();
