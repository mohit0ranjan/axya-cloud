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
 * ✅ Retry with exponential backoff (3 attempts)
 * ✅ Persistence via AsyncStorage (queue survives app restart)
 * ✅ Android progress notifications via expo-notifications
 */

import { File, Paths } from 'expo-file-system';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
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
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Convert a Uint8Array to a Base64 string (used for native chunk uploads) */
function uint8ArrayToBase64(bytes: Uint8Array): string {
    let binary = '';
    const chunkSize = 8192;
    for (let i = 0; i < bytes.byteLength; i += chunkSize) {
        binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunkSize)) as number[]);
    }
    return btoa(binary);
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
    // ✅ 3 concurrent uploads — matches server semaphore. Raised from 2 → 3 for throughput.
    private readonly MAX_CONCURRENT = 3;
    // ✅ 5 retries — handles Telegram FLOOD_WAIT and Render cold starts gracefully
    private readonly MAX_RETRIES = 5;
    private readonly CHUNK_SIZE = 5 * 1024 * 1024; // 5 MB chunks

    private activeUploads = 0;
    private listeners: ((tasks: UploadTask[]) => void)[] = [];

    /**
     * Map of taskId → AbortController.
     * Aborting signals the running performUpload to stop.
     */
    private abortControllers: Map<string, AbortController> = new Map();

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
                        ? { ...t, status: 'paused', progress: 0, bytesUploaded: 0 }
                        : t
                );
                this.notifyListeners();
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

    private notifyListeners() {
        this.saveQueue();
        this.updateNotification();
        const snapshot = this.snapshotTasks();
        this.listeners.forEach(l => l(snapshot));
    }

    // ── Notifications ─────────────────────────────────────────────────────────

    private async updateNotification() {
        const active = this.tasks.filter(
            t => t.status === 'uploading' || t.status === 'queued' || t.status === 'retrying'
        );

        if (active.length > 0) {
            const overallProgress = Math.round(
                active.reduce((acc, t) => acc + t.progress, 0) / active.length
            );
            const uploadingNow = this.tasks.filter(t => t.status === 'uploading').length;
            const queuedCount = this.tasks.filter(t => t.status === 'queued').length;
            const parts: string[] = [];
            if (uploadingNow > 0) parts.push(`${uploadingNow} uploading`);
            if (queuedCount > 0) parts.push(`${queuedCount} queued`);

            try {
                await Notifications.scheduleNotificationAsync({
                    identifier: 'upload_progress',
                    content: {
                        title: `Axya · ${overallProgress}%`,
                        body: parts.join(' · ') || `${active.length} file(s) in progress...`,
                        data: { type: 'upload_progress', progress: overallProgress },
                        android: {
                            channelId: 'upload_channel',
                            ongoing: true,
                            onlyAlertOnce: true,
                            progress: {
                                max: 100,
                                current: overallProgress,
                                indeterminate: overallProgress === 0,
                            },
                            smallIcon: 'notification_icon',
                            color: '#4B6EF5',
                            priority: Notifications.AndroidNotificationPriority.LOW,
                        },
                    } as any,
                    trigger: null,
                });
            } catch { /* non-critical */ }
        } else {
            try {
                await Notifications.dismissNotificationAsync('upload_progress');

                const completed = this.tasks.filter(t => t.status === 'completed').length;
                const failed = this.tasks.filter(t => t.status === 'failed').length;
                if (completed > 0 || failed > 0) {
                    await Notifications.scheduleNotificationAsync({
                        content: {
                            title: failed > 0 ? 'Upload finished ⚠️' : 'Upload complete ✅',
                            body: failed > 0
                                ? `${completed} done · ${failed} failed — tap to retry`
                                : `${completed} file${completed > 1 ? 's' : ''} synced to Axya`,
                            android: {
                                channelId: 'upload_channel',
                                color: failed > 0 ? '#EF4444' : '#1FD45A',
                                priority: Notifications.AndroidNotificationPriority.DEFAULT,
                            },
                        } as any,
                        trigger: null,
                    });
                }
            } catch { /* non-critical */ }
        }
    }

    // ── Public API ────────────────────────────────────────────────────────────

    public addUploads(
        files: FileAsset[],
        folderId: string | null = null,
        chatTarget: string = 'me'
    ) {
        const newTasks: UploadTask[] = files.map(file => ({
            id: `${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
            file,
            folderId,
            chatTarget,
            progress: 0,
            bytesUploaded: 0,
            status: 'queued',
            retryCount: 0,
        }));
        this.tasks.push(...newTasks);
        this.notifyListeners();
        this.processQueue();
    }

    public pause(id: string) {
        const task = this.tasks.find(t => t.id === id);
        if (!task) return;
        if (['queued', 'uploading', 'retrying'].includes(task.status)) {
            task.status = 'paused';
            this.abortControllers.get(id)?.abort();
            this.notifyListeners();
        }
    }

    public resume(id: string) {
        const task = this.tasks.find(t => t.id === id);
        if (!task) return;
        if (task.status === 'paused' || task.status === 'failed') {
            task.status = 'queued';
            task.retryCount = 0;
            task.error = undefined;
            task.progress = 0;
            task.bytesUploaded = 0;
            task.uploadId = undefined;
            this.notifyListeners();
            this.processQueue();
        }
    }

    public cancel(id: string) {
        const task = this.tasks.find(t => t.id === id);
        if (!task) return;
        task.status = 'cancelled';
        this.abortControllers.get(id)?.abort();
        this.notifyListeners();
        this.processQueue();
    }

    public cancelAll() {
        this.tasks.forEach(task => {
            if (!['completed', 'failed'].includes(task.status)) {
                task.status = 'cancelled';
                this.abortControllers.get(task.id)?.abort();
            }
        });
        this.notifyListeners();
    }

    public clearCompleted() {
        this.tasks = this.tasks.filter(
            t => t.status !== 'completed' && t.status !== 'cancelled' && t.status !== 'failed'
        );
        this.notifyListeners();
    }

    public retryFailed() {
        this.tasks
            .filter(t => t.status === 'failed')
            .forEach(t => {
                t.status = 'queued';
                t.retryCount = 0;
                t.error = undefined;
                t.progress = 0;
                t.bytesUploaded = 0;
                t.uploadId = undefined;
            });
        this.notifyListeners();
        this.processQueue();
    }

    // ── Queue Processor ───────────────────────────────────────────────────────

    private async processQueue(): Promise<void> {
        if (this.activeUploads >= this.MAX_CONCURRENT) return;

        const nextTask = this.tasks.find(
            t => t.status === 'queued' || t.status === 'retrying'
        );
        if (!nextTask) return;

        this.activeUploads++;
        nextTask.status = 'uploading';
        this.notifyListeners();

        try {
            await this.performUpload(nextTask);
            nextTask.status = 'completed';
            nextTask.progress = 100;
            nextTask.bytesUploaded = nextTask.file.size;
        } catch (e: any) {
            const status = nextTask.status as UploadStatus;

            const isCancelOrPauseError = e?.name === 'AbortError' || e?.message === 'Cancelled';

            if (isCancelOrPauseError || status === 'cancelled') {
                if (status !== 'paused') nextTask.status = 'cancelled';
                // If status is already 'paused', keep it
            } else if (status === 'paused') {
                // Keep paused
            } else {
                nextTask.retryCount++;
                if (nextTask.retryCount <= this.MAX_RETRIES) {
                    nextTask.status = 'retrying';
                    const delay = (Math.pow(2, nextTask.retryCount) + 1) * 1000;
                    console.warn(
                        `[UploadManager] Retry ${nextTask.retryCount}/${this.MAX_RETRIES}`,
                        `"${nextTask.file.name}" in ${delay / 1000}s:`, e?.message
                    );
                    setTimeout(() => this.processQueue(), delay);
                } else {
                    nextTask.status = 'failed';
                    nextTask.error = e?.message || 'Upload failed';
                }
            }
        } finally {
            this.abortControllers.delete(nextTask.id);
            this.activeUploads = Math.max(0, this.activeUploads - 1);
            this.notifyListeners();
            this.processQueue(); // Chain next upload
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
            this.notifyListeners();
            return;
        }

        const { uploadId } = initRes.data;
        task.uploadId = uploadId;

        // ── Step 3: Upload chunks ────────────────────────────────────────────
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

                await uploadClient.post('/files/upload/chunk', formData, { signal: abort.signal });

                offset = Math.min(offset + this.CHUNK_SIZE, file.size);
                chunkIndex++;
                task.progress = Math.round(Math.min((offset / file.size) * 45, 45));
                task.bytesUploaded = offset;
                this.notifyListeners();
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
                    { signal: abort.signal }
                );

                offset += length;
                chunkIndex++;
                task.progress = Math.round(Math.min((offset / file.size) * 45, 45));
                task.bytesUploaded = offset;
                this.notifyListeners();
            }
        }

        throwIfCancelled();
        task.progress = 50;
        this.notifyListeners();

        // ── Step 4: Finalise on server ───────────────────────────────────────
        await uploadClient.post(
            '/files/upload/complete',
            { uploadId },
            { signal: abort.signal }
        );

        // ── Step 5: Poll Telegram delivery status (50% → 100%) ───────────────
        await new Promise<void>((resolve, reject) => {
            const maxWait = Date.now() + 10 * 60 * 1000;

            const timer = setInterval(async () => {
                if (isCancelled() || Date.now() > maxWait) {
                    clearInterval(timer);
                    reject(new Error(Date.now() > maxWait ? 'Upload timed out' : 'Cancelled'));
                    return;
                }

                try {
                    const res = await apiClient.get(
                        `/files/upload/status/${uploadId}`,
                        { signal: abort.signal }
                    );
                    const { status, progress: tgProgress, error: tgError } = res.data;

                    if (status === 'completed') {
                        clearInterval(timer);
                        task.progress = 100;
                        task.bytesUploaded = file.size;
                        this.notifyListeners();
                        resolve();
                    } else if (status === 'error') {
                        clearInterval(timer);
                        reject(new Error(tgError || 'Telegram upload failed'));
                    } else {
                        task.progress = Math.round(50 + ((tgProgress || 0) * 0.5));
                        this.notifyListeners();
                    }
                } catch (e: any) {
                    if (e.name === 'CanceledError' || e.name === 'AbortError') {
                        clearInterval(timer);
                        reject(new Error('Cancelled'));
                    }
                    // Transient poll errors → keep polling
                }
            }, 2000);

            abort.signal.addEventListener('abort', () => {
                clearInterval(timer);
                reject(new Error('Cancelled'));
            });
        });
    }

    // ── Background support ────────────────────────────────────────────────────

    public resumeAllBackground() {
        this.processQueue();
    }
}

// Singleton shared across the entire app lifetime
export const uploadManager = new UploadManager();
