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
import { Buffer } from 'buffer';
import apiClient, { uploadClient } from './apiClient';

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
    return `${file.uri}|${file.name}|${file.size}`;
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
    // Prefer new File API for file:// URIs
    if (uri.startsWith('file://')) {
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
                    t.status === 'uploading' || t.status === 'retrying'
                        ? { ...t, status: 'paused' as UploadStatus, progress: 0, bytesUploaded: 0 }
                        : t
                );
                this.notifyListeners(true); // force, bypass throttle for initial load
            }
        } catch (e) {
            console.error('[UploadManager] Failed to load queue:', e);
        }
    }

    private saveQueue() {
        const toSave = this.tasks.filter(
            t => t.status !== 'completed' && t.status !== 'cancelled'
        );
        AsyncStorage.setItem('@upload_queue_v2', JSON.stringify(toSave)).catch(() => { });
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
        return this.tasks.map(t => ({ ...t }));
    }

    /**
     * Throttled notify — avoids flooding React with state updates during
     * rapid chunk uploads. Forces immediate notify for status changes (force=true).
     */
    private notifyListeners(force = false) {
        this.saveQueue();

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

    /**
     * Compute real aggregate stats from tasks.
     * Used by both notifications and the context.
     */
    public getStats() {
        const totalFiles = this.tasks.length;
        const uploadedCount = this.tasks.filter(t => t.status === 'completed').length;
        const queuedCount = this.tasks.filter(t => t.status === 'queued').length;
        const failedCount = this.tasks.filter(t => t.status === 'failed').length;
        const activeCount = this.tasks.filter(
            t => t.status === 'uploading' || t.status === 'queued' || t.status === 'retrying'
        ).length;
        const uploadingCount = this.tasks.filter(t => t.status === 'uploading').length;
        const pausedCount = this.tasks.filter(t => t.status === 'paused').length;
        const cancelledCount = this.tasks.filter(t => t.status === 'cancelled').length;

        // Byte-accurate progress computation
        const totalBytes = this.tasks.reduce((acc, t) => acc + Math.max(t.file.size || 1, 1), 0);
        const uploadedBytes = this.tasks.reduce((acc, t) => {
            if (t.status === 'completed') return acc + Math.max(t.file.size || 1, 1);
            return acc + (t.bytesUploaded || 0);
        }, 0);

        const overallProgress = totalBytes > 0
            ? Math.round(Math.min((uploadedBytes / totalBytes) * 100, 100))
            : 0;

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
            overallProgress,
        };
    }

    // ── Notifications ─────────────────────────────────────────────────────────

    private async updateNotification() {
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
            const fp = makeFingerprint(file);
            if (existingFingerprints.has(fp)) {
                console.log(`[UploadManager] Skipped duplicate: "${file.name}"`);
                continue;
            }
            existingFingerprints.add(fp);
            newTasks.push({
                id: `${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
                file,
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
        this.processQueue();
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

    private async processQueue(): Promise<void> {
        if (this.activeUploads >= this.MAX_CONCURRENT) return;

        const nextTask = this.tasks.find(
            t => t.status === 'queued' || t.status === 'retrying'
        );
        if (!nextTask) return;

        this.transition(nextTask, 'uploading');
        this.notifyListeners(true);

        try {
            await this.performUpload(nextTask);
            this.transition(nextTask, 'completed');
            nextTask.progress = 100;
            nextTask.bytesUploaded = nextTask.file.size;
        } catch (e: any) {
            const status = nextTask.status as UploadStatus;

            const isCancelOrPauseError = e?.name === 'AbortError' || e?.message === 'Cancelled';
            const isFatalSchemaError = e?.message?.includes('constraint') || e?.message?.includes('duplicate key');
            // ✅ Fix 6: Telegram fatal errors should NOT be retried
            const isFatalTelegramError = e?.message?.includes('FILE_PARTS_INVALID')
                || e?.message?.includes('FILE_REFERENCE_EXPIRED')
                || e?.message?.includes('MEDIA_EMPTY')
                || e?.message?.includes('FILE_ID_INVALID')
                || (e?.message?.includes('400:') && !e?.message?.includes('FLOOD'));

            if (isCancelOrPauseError || status === 'cancelled') {
                if (status !== 'paused') this.transition(nextTask, 'cancelled');
                // If status is already 'paused', keep it
            } else if (status === 'paused') {
                // Keep paused
            } else if (isFatalSchemaError || isFatalTelegramError) {
                // Do not retry fatal database/Telegram errors
                this.transition(nextTask, 'failed');
                nextTask.error = e?.message || 'Upload failed (non-recoverable)';
            } else {
                nextTask.retryCount++;
                if (nextTask.retryCount <= this.MAX_RETRIES) {
                    this.transition(nextTask, 'waiting_retry');
                    const delay = (Math.pow(2, nextTask.retryCount) + 1) * 1000;
                    console.warn(
                        `[UploadManager] Retry ${nextTask.retryCount}/${this.MAX_RETRIES}`,
                        `"${nextTask.file.name}" in ${delay / 1000}s:`, e?.message
                    );
                    setTimeout(() => {
                        const t = this.tasks.find(x => x.id === nextTask.id);
                        if (t && t.status === 'waiting_retry') {
                            this.transition(t, 'retrying');
                            this.notifyListeners(true);
                            this.processQueue();
                        } else {
                            // Task was cancelled/paused while waiting — still trigger process
                            this.processQueue();
                        }
                    }, delay);
                } else {
                    this.transition(nextTask, 'failed');
                    nextTask.error = e?.message || 'Upload failed';
                }
            }
        } finally {
            this.abortControllers.delete(nextTask.id);
            // ✅ Fix 2: Don't chain processQueue when retrying
            // — the retry timer will handle it after the backoff delay
            if (nextTask.status !== 'waiting_retry') {
                this.notifyListeners(true);
                this.processQueue();
            } else {
                this.notifyListeners(true);
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
                originalname: file.name,
                size: file.size,
                mimetype: file.mimeType || 'application/octet-stream',
                telegram_chat_id: chatTarget,
                folder_id: folderId,
                hash: fileHash,
            },
            { signal: abort.signal }
        );

        if (initRes.data.duplicate) {
            task.progress = 100;
            task.bytesUploaded = file.size;
            task.duplicate = true;
            this.notifyListeners(true);
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
                formData.append('chunk', new globalThis.File([chunk], file.name, { type: file.mimeType }));

                await uploadClient.post('/files/upload/chunk', formData, {
                    signal: abort.signal,
                    onUploadProgress: (progressEvent: any) => {
                        // ✅ Fix 3: Use known chunk size as fallback when total is unavailable
                        const chunkTotal = progressEvent.total || chunk.size || this.CHUNK_SIZE;
                        const fraction = chunkTotal > 0 ? progressEvent.loaded / chunkTotal : 0;
                        task.bytesUploaded = offset + Math.round(chunk.size * fraction);
                        task.progress = Math.round(
                            Math.min((task.bytesUploaded / file.size) * 50, 50)
                        );
                        this.notifyListeners(); // throttled
                    },
                });

                offset = Math.min(offset + this.CHUNK_SIZE, file.size);
                chunkIndex++;
                task.bytesUploaded = offset;
                task.progress = Math.round(Math.min((offset / file.size) * 50, 50));
                this.notifyListeners(); // throttled
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
                            task.bytesUploaded = offset + Math.round(length * fraction);
                            task.progress = Math.round(
                                Math.min((task.bytesUploaded / file.size) * 50, 50)
                            );
                            this.notifyListeners(); // throttled
                        },
                    }
                );

                offset += length;
                chunkIndex++;
                task.bytesUploaded = offset;
                task.progress = Math.round(Math.min((offset / file.size) * 50, 50));
                this.notifyListeners(); // throttled
            }
        }

        throwIfCancelled();
        task.progress = 50;
        this.notifyListeners(true);

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
                    const { status, progress: tgProgress, error: tgError } = res.data;

                    if (status === 'completed') {
                        task.progress = 100;
                        task.bytesUploaded = file.size;
                        this.notifyListeners(true);
                        settle(() => resolve());
                        return;
                    } else if (status === 'error' || status === 'cancelled') {
                        settle(() => reject(new Error(tgError || 'Telegram upload failed')));
                        return;
                    } else {
                        // Fix: update bytesUploaded during poll phase so stats compute correctly
                        const pollProgress = Math.round(50 + ((tgProgress || 0) * 0.5));
                        task.progress = pollProgress;
                        task.bytesUploaded = Math.round((pollProgress / 100) * file.size);
                        this.notifyListeners();
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
