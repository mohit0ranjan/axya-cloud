import * as FileSystem from 'expo-file-system';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import apiClient, { uploadClient } from './apiClient';

export interface FileAsset {
    uri: string;
    name: string;
    size: number;
    mimeType?: string;
}

export interface UploadTask {
    id: string;
    file: FileAsset;
    folderId: string | null;
    chatTarget: string;
    progress: number;
    status: 'pending' | 'queued' | 'uploading' | 'paused' | 'retrying' | 'completed' | 'failed' | 'cancelled';
    error?: string;
    retryCount: number;
    uploadId?: string; // from backend init
}

class UploadManager {
    public tasks: UploadTask[] = [];
    private MAX_CONCURRENT = 2; // Anti-429
    private MAX_RETRIES = 3;
    private activeUploads = 0;
    private listeners: ((tasks: UploadTask[]) => void)[] = [];
    private isBackground = false;

    // We store cancel controllers to abort axios requests or loops
    private abortControllers: Map<string, AbortController> = new Map();

    constructor() {
        this.loadQueue();
    }

    private async loadQueue() {
        try {
            const stored = await AsyncStorage.getItem('@upload_queue');
            if (stored) {
                const parsed: UploadTask[] = JSON.parse(stored);
                // Reset states of active tasks on restart
                this.tasks = parsed.map(t => {
                    if (t.status === 'uploading' || t.status === 'retrying') {
                        return { ...t, status: 'paused', progress: 0 }; // Pause interrupted ones to be safe
                    }
                    return t;
                });
                this.notify();
            }
        } catch (e) {
            console.error('Failed to load queue', e);
        }
    }

    private async saveQueue() {
        try {
            // Only save pending, queued, paused, retrying, uploading
            const toSave = this.tasks.filter(t => t.status !== 'completed' && t.status !== 'cancelled');
            await AsyncStorage.setItem('@upload_queue', JSON.stringify(toSave));
        } catch (e) { }
    }

    public subscribe(listener: (tasks: UploadTask[]) => void) {
        this.listeners.push(listener);
        listener([...this.tasks]);
        return () => {
            this.listeners = this.listeners.filter(l => l !== listener);
        };
    }

    private notify() {
        this.saveQueue();
        this.updateNotification();
        const copy = [...this.tasks];
        this.listeners.forEach(l => l(copy));
    }

    private async updateNotification() {
        const activeTasks = this.tasks.filter(t => t.status === 'uploading' || t.status === 'queued' || t.status === 'retrying');
        if (activeTasks.length > 0) {
            const overallProgress = Math.round(activeTasks.reduce((acc, t) => acc + t.progress, 0) / activeTasks.length);

            Notifications.scheduleNotificationAsync({
                identifier: 'upload_progress',
                content: {
                    title: 'Axya File Sync',
                    body: `Uploading ${activeTasks.length} files... (${overallProgress}%)`,
                    sticky: true,
                    autoDismiss: false,
                } as any,
                trigger: null,
            });
        } else {
            Notifications.dismissNotificationAsync('upload_progress');
            const completed = this.tasks.filter(t => t.status === 'completed').length;
            const failed = this.tasks.filter(t => t.status === 'failed').length;

            if (completed > 0 || failed > 0) {
                Notifications.scheduleNotificationAsync({
                    content: {
                        title: 'Sync Finished ✅',
                        body: `${completed} successful, ${failed} failed.`,
                    },
                    trigger: null,
                });
            }
        }
    }

    // Helper: random delay to prevent burst
    private sleepRandom(min = 300, max = 800) {
        const ms = Math.floor(Math.random() * (max - min + 1)) + min;
        return new Promise(r => setTimeout(r, ms));
    }

    public addUploads(files: FileAsset[], folderId: string | null = null, chatTarget: string = 'me') {
        const newTasks = files.map(file => ({
            id: Math.random().toString(36).substring(7),
            file,
            folderId,
            chatTarget,
            progress: 0,
            status: 'queued' as const,
            retryCount: 0
        }));

        this.tasks.push(...newTasks);
        this.notify();
        this.processQueue();
    }

    public pause(id: string) {
        const task = this.tasks.find(t => t.id === id);
        if (task && (task.status === 'queued' || task.status === 'uploading' || task.status === 'retrying')) {
            task.status = 'paused';
            this.abortControllers.get(id)?.abort();
            this.notify();
        }
    }

    public resume(id: string) {
        const task = this.tasks.find(t => t.id === id);
        if (task && (task.status === 'paused' || task.status === 'failed')) {
            task.status = 'queued';
            task.retryCount = 0;
            task.error = undefined;
            this.notify();
            this.processQueue();
        }
    }

    public cancel(id: string) {
        const task = this.tasks.find(t => t.id === id);
        if (task) {
            task.status = 'cancelled';
            this.abortControllers.get(id)?.abort();
            this.notify();
            this.processQueue();
        }
    }

    public cancelAll() {
        this.tasks.forEach(task => {
            if (task.status !== 'completed') {
                task.status = 'cancelled';
                this.abortControllers.get(task.id)?.abort();
            }
        });
        this.notify();
    }

    public clearCompleted() {
        this.tasks = this.tasks.filter(t => t.status !== 'completed' && t.status !== 'cancelled');
        this.notify();
    }

    private async processQueue() {
        if (this.activeUploads >= this.MAX_CONCURRENT) return;

        const nextTask = this.tasks.find(t => t.status === 'queued' || t.status === 'retrying');
        if (!nextTask) return;

        this.activeUploads++;
        nextTask.status = 'uploading';
        this.notify();

        try {
            await this.sleepRandom();
            await this.performUpload(nextTask);
            nextTask.status = 'completed';
            nextTask.progress = 100;
        } catch (e: any) {
            if (e.message === 'Cancelled' || nextTask.status === 'cancelled') {
                nextTask.status = 'cancelled';
            } else if (nextTask.status === 'paused') {
                // Keep it paused
            } else {
                nextTask.retryCount++;
                if (nextTask.retryCount <= this.MAX_RETRIES) {
                    nextTask.status = 'retrying';
                    const delay = Math.pow(2, nextTask.retryCount) * 1000 + 1000; // 3s, 5s, 9s
                    setTimeout(() => this.processQueue(), delay);
                } else {
                    nextTask.status = 'failed';
                    nextTask.error = e.message || 'Upload failed';
                }
            }
        } finally {
            this.abortControllers.delete(nextTask.id);
            this.activeUploads--;
            this.notify();
            // Start next process loop
            this.processQueue();
        }
    }

    private async performUpload(task: UploadTask): Promise<void> {
        const abortController = new AbortController();
        this.abortControllers.set(task.id, abortController);

        const isCancelled = () => task.status === 'cancelled' || task.status === 'paused' || abortController.signal.aborted;

        const { file, folderId, chatTarget } = task;
        const originalname = file.name;
        const mimetype = file.mimeType || 'application/octet-stream';
        const size = file.size;

        // 1. Calculate File Hash locally for deduplication (only if native FileSystem is available)
        let fileHash = '';
        if (Platform.OS !== 'web') {
            try {
                const fileInfo = await FileSystem.getInfoAsync(file.uri, { md5: true });
                if (fileInfo.exists && fileInfo.md5) {
                    fileHash = fileInfo.md5; // Use MD5 as it's computed very fast by native code
                }
            } catch (err) {
                console.warn('Could not generate file hash', err);
            }
        }

        if (isCancelled()) throw new Error('Cancelled');

        // 2. Initialize
        const initRes = await uploadClient.post('/files/upload/init', {
            originalname,
            size,
            mimetype,
            telegram_chat_id: chatTarget,
            folder_id: folderId,
            hash: fileHash
        }, { signal: abortController.signal });

        // If duplicate was found and handled by server
        if (initRes.data.duplicate) {
            task.progress = 100;
            return; // Finished immediately
        }

        const { uploadId } = initRes.data;
        task.uploadId = uploadId;

        // 3. Upload chunks
        const CHUNK_SIZE = 5 * 1024 * 1024; // 5MB
        let offset = 0;
        let chunkIndex = 0;

        if (Platform.OS === 'web') {
            const blobResponse = await fetch(file.uri);
            const blob = await blobResponse.blob();

            while (offset < size) {
                if (isCancelled()) throw new Error('Cancelled');

                const chunk = blob.slice(offset, offset + CHUNK_SIZE);
                const formData = new FormData();
                formData.append('uploadId', uploadId);
                formData.append('chunkIndex', String(chunkIndex));
                formData.append('chunk', new File([chunk], originalname, { type: mimetype }));

                await uploadClient.post('/files/upload/chunk', formData, { signal: abortController.signal });

                offset += CHUNK_SIZE;
                chunkIndex++;
                task.progress = Math.min((offset / size) * 50, 50);
                this.notify();
            }
        } else {
            while (offset < size) {
                if (isCancelled()) throw new Error('Cancelled');

                const length = Math.min(CHUNK_SIZE, size - offset);
                const chunkBase64 = await FileSystem.readAsStringAsync(file.uri, {
                    encoding: 'base64',
                    position: offset,
                    length: length
                });

                await uploadClient.post('/files/upload/chunk', {
                    uploadId,
                    chunkIndex,
                    chunkBase64
                }, { signal: abortController.signal });

                offset += length;
                chunkIndex++;
                task.progress = Math.min((offset / size) * 45, 45); // 45% for app->server
                this.notify();
            }
        }

        if (isCancelled()) throw new Error('Cancelled');
        task.progress = 50;
        this.notify();

        // 4. Complete server-side upload
        await uploadClient.post('/files/upload/complete', { uploadId }, { signal: abortController.signal });

        // 5. Poll for Telegram status
        return new Promise<void>((resolve, reject) => {
            const timer = setInterval(async () => {
                if (isCancelled()) {
                    clearInterval(timer);
                    reject(new Error('Cancelled'));
                    return;
                }

                try {
                    const statusRes = await apiClient.get(`/files/upload/status/${uploadId}`, { signal: abortController.signal });
                    const state = statusRes.data;

                    if (state.status === 'completed') {
                        clearInterval(timer);
                        task.progress = 100;
                        this.notify();
                        resolve();
                    } else if (state.status === 'error') {
                        clearInterval(timer);
                        reject(new Error(state.error || 'Telegram upload failed'));
                    } else {
                        const telegramProgress = state.progress || 0;
                        task.progress = 50 + (telegramProgress * 0.5);
                        this.notify();
                    }
                } catch (e: any) {
                    if (e.name === 'CanceledError') {
                        clearInterval(timer);
                        reject(new Error('Cancelled'));
                    }
                    console.warn('[Upload] Poll error:', e.message);
                }
            }, 2000);

            // Allow manual cancellation from outside to break this promise
            abortController.signal.addEventListener('abort', () => {
                clearInterval(timer);
                reject(new Error('Cancelled'));
            });
        });
    }

    // Public method for Background fetch / Task manager
    public resumeAllBackground() {
        this.isBackground = true;
        this.processQueue();
    }
}

export const uploadManager = new UploadManager();
