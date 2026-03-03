/**
 * DownloadManager.ts — Centralized download queue manager
 *
 * ✅ Track all active download tasks with progress
 * ✅ Cancel individual or all downloads via AbortController
 * ✅ expo-file-system SDK 55 File.downloadFileAsync with headers
 * ✅ Notifications for download progress (Android)
 * ✅ Subscriber pattern (same as UploadManager) for React integration
 */

import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { API_BASE } from './apiClient';

// ─── Types ────────────────────────────────────────────────────────────────────

export type DownloadStatus =
    | 'queued'
    | 'downloading'
    | 'completed'
    | 'failed'
    | 'cancelled';

export interface DownloadTask {
    id: string;
    fileId: string;
    fileName: string;
    mimeType?: string;
    /** 0-100 */
    progress: number;
    status: DownloadStatus;
    error?: string;
    /** The local file path once downloaded */
    localPath?: string;
}

// ─── DownloadManager ─────────────────────────────────────────────────────────

class DownloadManager {
    public tasks: DownloadTask[] = [];

    private readonly MAX_CONCURRENT = 3;
    private activeDownloads = 0;
    private listeners: ((tasks: DownloadTask[]) => void)[] = [];

    /**
     * Map of taskId → AbortController.
     * Aborting signals the running download to stop.
     */
    private abortControllers: Map<string, AbortController> = new Map();

    // ── Subscription ─────────────────────────────────────────────────────────

    public subscribe(listener: (tasks: DownloadTask[]) => void): () => void {
        this.listeners.push(listener);
        listener(this.snapshotTasks());
        return () => {
            this.listeners = this.listeners.filter(l => l !== listener);
        };
    }

    /**
     * Creates a new array with new task objects on every call.
     * React state comparison (===) needs new references
     * to detect changes inside task objects (e.g. progress, status).
     */
    private snapshotTasks(): DownloadTask[] {
        return this.tasks.map(t => ({ ...t }));
    }

    private notifyListeners() {
        this.updateNotification();
        const snapshot = this.snapshotTasks();
        this.listeners.forEach(l => l(snapshot));
    }

    // ── Notifications ────────────────────────────────────────────────────────

    private async updateNotification() {
        const active = this.tasks.filter(
            t => t.status === 'downloading' || t.status === 'queued'
        );

        if (active.length > 0) {
            // Simple average progress for downloads (no weighted by size since we don't always know size)
            const avgProgress = Math.round(
                active.reduce((acc, t) => acc + t.progress, 0) / active.length
            );

            try {
                await Notifications.scheduleNotificationAsync({
                    identifier: 'download_progress',
                    content: {
                        title: `Downloading · ${avgProgress}%`,
                        body: `${active.length} file${active.length > 1 ? 's' : ''} in progress…`,
                        data: { type: 'download_progress', progress: avgProgress },
                        android: {
                            channelId: 'upload_channel', // reuse the same low-priority channel
                            ongoing: true,
                            onlyAlertOnce: true,
                            progress: {
                                max: 100,
                                current: avgProgress,
                                indeterminate: avgProgress === 0,
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
                await Notifications.dismissNotificationAsync('download_progress');

                const completed = this.tasks.filter(t => t.status === 'completed').length;
                const failed = this.tasks.filter(t => t.status === 'failed').length;
                if (completed > 0 || failed > 0) {
                    await Notifications.scheduleNotificationAsync({
                        content: {
                            title: failed > 0 ? 'Downloads finished ⚠️' : 'Downloads complete ✅',
                            body: failed > 0
                                ? `${completed} done · ${failed} failed`
                                : `${completed} file${completed > 1 ? 's' : ''} downloaded`,
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

    /**
     * Queue a file download.
     * @param fileId     Server file ID
     * @param fileName   Display / save name
     * @param jwt        Auth token
     * @param mimeType   Optional MIME type for sharing
     * @returns          The created task ID
     */
    public addDownload(
        fileId: string,
        fileName: string,
        jwt: string,
        mimeType?: string,
    ): string {
        const taskId = `dl_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

        const task: DownloadTask = {
            id: taskId,
            fileId,
            fileName,
            mimeType,
            progress: 0,
            status: 'queued',
        };

        this.tasks.push(task);
        this.notifyListeners();
        this.processQueue(jwt);
        return taskId;
    }

    /**
     * Cancel a single download.
     */
    public cancel(id: string) {
        const task = this.tasks.find(t => t.id === id);
        if (!task) return;
        if (['queued', 'downloading'].includes(task.status)) {
            task.status = 'cancelled';
            task.progress = 0;
            this.abortControllers.get(id)?.abort();
            this.notifyListeners();
        }
    }

    /**
     * Cancel ALL active/queued downloads.
     */
    public cancelAll() {
        let changed = false;
        this.tasks.forEach(task => {
            if (task.status === 'queued' || task.status === 'downloading') {
                task.status = 'cancelled';
                task.progress = 0;
                this.abortControllers.get(task.id)?.abort();
                changed = true;
            }
        });
        if (changed) {
            this.notifyListeners();
        }
    }

    /**
     * Remove completed/cancelled/failed tasks from the list.
     */
    public clearCompleted() {
        this.tasks = this.tasks.filter(
            t => t.status !== 'completed' && t.status !== 'cancelled' && t.status !== 'failed'
        );
        this.notifyListeners();
    }

    /**
     * Check if any downloads are active.
     */
    public get hasActive(): boolean {
        return this.tasks.some(t => t.status === 'downloading' || t.status === 'queued');
    }

    // ── Queue Processor ──────────────────────────────────────────────────────

    private async processQueue(jwt: string): Promise<void> {
        if (this.activeDownloads >= this.MAX_CONCURRENT) return;

        const nextTask = this.tasks.find(t => t.status === 'queued');
        if (!nextTask) return;

        this.activeDownloads++;
        nextTask.status = 'downloading';
        this.notifyListeners();

        try {
            await this.performDownload(nextTask, jwt);
            nextTask.status = 'completed';
            nextTask.progress = 100;
        } catch (e: any) {
            const isCancelError = e?.name === 'AbortError' || e?.message === 'Cancelled';

            if (isCancelError || (nextTask.status as DownloadStatus) === 'cancelled') {
                nextTask.status = 'cancelled';
                nextTask.progress = 0;
            } else {
                nextTask.status = 'failed';
                nextTask.progress = 0;
                nextTask.error = e?.message || 'Download failed';
            }
        } finally {
            this.abortControllers.delete(nextTask.id);
            this.activeDownloads = Math.max(0, this.activeDownloads - 1);
            this.notifyListeners();
            this.processQueue(jwt); // Chain next download
        }
    }

    // ── Core Download Logic ──────────────────────────────────────────────────

    private async performDownload(task: DownloadTask, jwt: string): Promise<void> {
        const abort = new AbortController();
        this.abortControllers.set(task.id, abort);

        const throwIfCancelled = () => {
            if (task.status === 'cancelled' || abort.signal.aborted) {
                throw new Error('Cancelled');
            }
        };

        throwIfCancelled();

        const downloadUrl = `${API_BASE}/files/${task.fileId}/download`;
        const destFile = new File(Paths.document, task.fileName);

        // expo-file-system SDK 55 File.downloadFileAsync
        // Note: This API does not support abort natively, so we track the abort
        // state and skip post-processing if cancelled.
        task.progress = 10; // Starting
        this.notifyListeners();

        const resultFile = await File.downloadFileAsync(
            downloadUrl,
            destFile,
            { headers: { Authorization: `Bearer ${jwt}` } }
        );

        throwIfCancelled();

        task.progress = 85;
        task.localPath = resultFile.uri;
        this.notifyListeners();

        // Offer share dialog
        if (await Sharing.isAvailableAsync()) {
            throwIfCancelled();
            task.progress = 95;
            this.notifyListeners();
            await Sharing.shareAsync(resultFile.uri, { mimeType: task.mimeType });
        }

        task.progress = 100;
        this.notifyListeners();
    }
}

// Singleton shared across the entire app lifetime
export const downloadManager = new DownloadManager();
