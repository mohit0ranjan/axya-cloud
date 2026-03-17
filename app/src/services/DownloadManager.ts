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
import * as LegacyFileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { API_BASE } from './apiClient';
import { buildApiFileUrl } from '../utils/fileSafety';
import { getNotificationsEnabled } from '../utils/preferences';

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
    private readonly notificationsEnabled =
        Platform.OS !== 'web' && typeof Notifications.scheduleNotificationAsync === 'function';
    private activeDownloads = 0;
    private listeners: ((tasks: DownloadTask[]) => void)[] = [];

    /**
     * Map of taskId → DownloadResumable.
     * Allows true transport-level cancellation via cancelAsync().
     */
    private downloadWorkers: Map<string, LegacyFileSystem.DownloadResumable> = new Map();

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
        if (!this.notificationsEnabled || !(await getNotificationsEnabled())) return;
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
            const worker = this.downloadWorkers.get(id);
            if (worker) {
                worker.cancelAsync().catch(() => { });
            }
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
                const worker = this.downloadWorkers.get(task.id);
                if (worker) {
                    worker.cancelAsync().catch(() => { });
                }
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
            this.downloadWorkers.delete(nextTask.id);
            this.activeDownloads = Math.max(0, this.activeDownloads - 1);
            this.notifyListeners();
            this.processQueue(jwt); // Chain next download
        }
    }

    // ── Core Download Logic ──────────────────────────────────────────────────

    private sanitizeFileName(name: string): string {
        const trimmed = String(name || '').trim();
        const base = trimmed || 'download';
        const cleaned = base
            .replace(/[\/\\:*?"<>|\r\n]+/g, '_')
            .replace(/\s+/g, ' ')
            .trim();
        return cleaned || 'download';
    }

    private buildHttpErrorMessage(status: number, responseBody?: string): string {
        const parsed = responseBody?.trim();
        let code = '';
        let backendError = '';
        if (parsed) {
            try {
                const json = JSON.parse(parsed);
                code = String(json?.code || '').toLowerCase();
                backendError = String(json?.message || json?.error || '').trim();
            } catch {
                // keep defaults
            }
        }

        if (code === 'schema_not_ready') return 'Service is starting. Please retry in a moment.';
        if (code === 'telegram_session_expired') return 'Telegram session expired. Please reconnect Telegram.';
        if (code === 'telegram_message_not_found') return 'File no longer exists in Telegram.';
        if (code === 'telegram_chat_invalid') return 'File source mapping is invalid. Re-upload may be required.';
        if (backendError) return backendError;

        if (status === 401) return 'Unauthorized. Please sign in again.';
        if (status === 403) return 'You do not have access to this file.';
        if (status === 404) return 'File not found.';
        if (status === 409) return 'File metadata is invalid. Please re-upload the file.';
        if (status === 502) return 'Telegram file fetch failed. Try again.';
        if (status === 503) return 'Telegram session unavailable. Please reconnect Telegram.';
        return `Download failed (${status})`;
    }

    private async performDownload(task: DownloadTask, jwt: string): Promise<void> {
        const throwIfCancelled = () => {
            if (task.status === 'cancelled') {
                throw new Error('Cancelled');
            }
        };

        throwIfCancelled();

        const downloadUrl = buildApiFileUrl(API_BASE, task.fileId, 'download');
        const safeFileName = this.sanitizeFileName(task.fileName);
        const destFile = new File(Paths.document, safeFileName);

        task.progress = 5; // Starting
        this.notifyListeners();

        const worker = LegacyFileSystem.createDownloadResumable(
            downloadUrl,
            destFile.uri,
            { headers: { Authorization: `Bearer ${jwt}` } },
            (progressData) => {
                if (task.status === 'cancelled') return;
                const total = progressData.totalBytesExpectedToWrite || 0;
                const written = progressData.totalBytesWritten || 0;
                if (total > 0) {
                    // Keep room for post-download processing (share/save).
                    task.progress = Math.max(5, Math.min(90, Math.round((written / total) * 90)));
                    this.notifyListeners();
                }
            }
        );
        this.downloadWorkers.set(task.id, worker);
        const result = await worker.downloadAsync();
        if (!result?.uri) throw new Error('Download failed');
        if ((result.status ?? 0) < 200 || (result.status ?? 0) >= 300) {
            let body = '';
            try {
                body = await LegacyFileSystem.readAsStringAsync(result.uri);
            } catch {
                // non-fatal, fallback to status code only
            }
            const message = this.buildHttpErrorMessage(result.status || 0, body);
            try {
                await LegacyFileSystem.deleteAsync(result.uri, { idempotent: true });
            } catch {
                // cleanup failure is non-critical
            }
            throw new Error(message);
        }

        throwIfCancelled();

        task.progress = 85;
        task.localPath = result.uri;
        this.notifyListeners();

        // ── Device Download Logic ──
        if (Platform.OS === 'android') {
            try {
                const permissions = await LegacyFileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();
                if (permissions.granted) {
                    task.progress = 95;
                    this.notifyListeners();
                    const destUri = await LegacyFileSystem.StorageAccessFramework.createFileAsync(
                        permissions.directoryUri,
                        safeFileName,
                        task.mimeType || 'application/octet-stream'
                    );
                    const base64Str = await LegacyFileSystem.readAsStringAsync(result.uri, { encoding: LegacyFileSystem.EncodingType.Base64 });
                    await LegacyFileSystem.writeAsStringAsync(destUri, base64Str, { encoding: LegacyFileSystem.EncodingType.Base64 });
                    
                    task.progress = 100;
                    this.notifyListeners();
                    return;
                }
            } catch (safErr) {
                console.warn('SAF error or cancelled:', safErr);
            }
        }

        // Fallback to Share for iOS or if Android SAF fails/user cancels
        if (await Sharing.isAvailableAsync()) {
            throwIfCancelled();
            task.progress = 95;
            this.notifyListeners();
            await Sharing.shareAsync(result.uri, { mimeType: task.mimeType });
        }

        task.progress = 100;
        this.notifyListeners();
    }
}

// Singleton shared across the entire app lifetime
export const downloadManager = new DownloadManager();
