import { create } from 'zustand';
import * as DocumentPicker from 'expo-document-picker';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import apiClient, { uploadClient } from '../api/client';
import * as Notifications from 'expo-notifications';
import * as FileSystem from 'expo-file-system/legacy';

export interface UploadTask {
    id: string;
    file: any;
    progress: number;
    status: 'queued' | 'uploading' | 'completed' | 'failed' | 'cancelled';
    error?: string;
    folder_id?: string | null;
    chat_target?: string;
}

interface UploadState {
    tasks: UploadTask[];
    isUploading: boolean;
    addTask: (files: DocumentPicker.DocumentPickerAsset[], folderId?: string | null, chatTarget?: string) => void;
    retryTask: (id: string) => void;
    cancelTask: (id: string) => void;
    clearCompleted: () => void;
    processQueue: () => Promise<void>;
}

export const useUploadStore = create<UploadState>((set, get) => ({
    tasks: [],
    isUploading: false,

    addTask: (files, folderId = null, chatTarget = 'me') => {
        const newTasks: UploadTask[] = files.map(file => ({
            id: Math.random().toString(36).substring(7),
            file,
            progress: 0,
            status: 'queued',
            folder_id: folderId,
            chat_target: chatTarget,
        }));
        set(state => ({ tasks: [...state.tasks, ...newTasks] }));
        get().processQueue();
    },

    retryTask: (id) => {
        set(state => ({
            tasks: state.tasks.map(t => t.id === id ? { ...t, status: 'queued', progress: 0, error: undefined } : t)
        }));
        get().processQueue();
    },

    cancelTask: (id) => {
        set(state => ({
            tasks: state.tasks.map(t => t.id === id ? { ...t, status: 'cancelled' } : t)
        }));
    },

    clearCompleted: () => {
        set(state => ({
            tasks: state.tasks.filter(t => t.status === 'uploading' || t.status === 'queued')
        }));
    },

    processQueue: async () => {
        const state = get();
        if (state.isUploading) return;

        const nextTask = state.tasks.find(t => t.status === 'queued');
        if (!nextTask) {
            set({ isUploading: false });
            return;
        }

        set({ isUploading: true });

        const executeUpload = async (task: UploadTask) => {
            const updateTask = (updates: Partial<UploadTask>) => {
                set(s => ({
                    tasks: s.tasks.map(t => t.id === task.id ? { ...t, ...updates } : t)
                }));
            };

            updateTask({ status: 'uploading' });

            try {
                const { file, folder_id, chat_target } = task;
                const CHUNK_SIZE = 5 * 1024 * 1024; // 5MB chunks
                const fileSize = file.size;
                const originalname = file.name;
                const mimetype = file.mimeType || 'application/octet-stream';

                // 1. Initialize Upload
                const initRes = await uploadClient.post('/files/upload/init', {
                    originalname,
                    size: fileSize,
                    mimetype,
                    telegram_chat_id: chat_target,
                    folder_id: folder_id
                });
                const { uploadId } = initRes.data;

                // 2. Upload Chunks
                let offset = 0;
                let chunkIndex = 0;

                if (Platform.OS === 'web') {
                    const blobResponse = await fetch(file.uri);
                    const blob = await blobResponse.blob();

                    while (offset < fileSize) {
                        // Check if cancelled
                        if (get().tasks.find(t => t.id === task.id)?.status === 'cancelled') throw new Error('Cancelled');

                        const chunk = blob.slice(offset, offset + CHUNK_SIZE);
                        const formData = new FormData();
                        formData.append('uploadId', uploadId);
                        formData.append('chunkIndex', String(chunkIndex));
                        formData.append('chunk', new File([chunk], originalname, { type: mimetype }));

                        await uploadClient.post('/files/upload/chunk', formData);
                        offset += CHUNK_SIZE;
                        chunkIndex++;
                        updateTask({ progress: Math.min((offset / fileSize) * 50, 50) });
                    }
                } else {
                    while (offset < fileSize) {
                        // Check if cancelled
                        if (get().tasks.find(t => t.id === task.id)?.status === 'cancelled') throw new Error('Cancelled');

                        const length = Math.min(CHUNK_SIZE, fileSize - offset);
                        const chunkBase64 = await FileSystem.readAsStringAsync(file.uri, {
                            encoding: 'base64',
                            position: offset,
                            length: length
                        });

                        await uploadClient.post('/files/upload/chunk', {
                            uploadId,
                            chunkIndex,
                            chunkBase64
                        });

                        offset += length;
                        chunkIndex++;
                        updateTask({ progress: Math.min((offset / fileSize) * 50, 50) });
                    }
                }

                // 3. Complete Upload & Begin Telegram Transfer
                updateTask({ progress: 55 });
                await uploadClient.post('/files/upload/complete', { uploadId });

                // 4. Poll for Telegram Progress
                await new Promise<void>((resolve, reject) => {
                    const timer = setInterval(async () => {
                        // Check if cancelled
                        if (get().tasks.find(t => t.id === task.id)?.status === 'cancelled') {
                            clearInterval(timer);
                            reject(new Error('Cancelled'));
                            return;
                        }

                        try {
                            const statusRes = await apiClient.get(`/files/upload/status/${uploadId}`);
                            const state = statusRes.data;

                            if (state.status === 'completed') {
                                clearInterval(timer);
                                updateTask({ progress: 100, status: 'completed' });
                                // ✅ Auto-prune completed task after 30s to prevent memory bloat
                                setTimeout(() => {
                                    set(s => ({ tasks: s.tasks.filter(t => t.id !== task.id) }));
                                }, 30_000);

                                resolve();
                            } else if (state.status === 'error') {
                                clearInterval(timer);
                                reject(new Error(state.error || 'Telegram upload failed'));
                            } else {
                                updateTask({ progress: 55 + (state.progress * 0.45) });
                            }
                        } catch (e) {
                            clearInterval(timer);
                            reject(new Error('Lost connection to upload status'));
                        }
                    }, 1500);
                });

                // Send success notification
                if (Platform.OS !== 'web') {
                    await Notifications.scheduleNotificationAsync({
                        content: {
                            title: 'Upload Complete ✅',
                            body: `${originalname} has been uploaded to Axya`,
                        },
                        trigger: null,
                    });
                }

            } catch (e: any) {
                if (e.message === 'Cancelled') {
                    updateTask({ status: 'cancelled' });
                } else {
                    const msg = e.response?.data?.error || e.message || 'Upload failed';
                    updateTask({ status: 'failed', error: msg });
                }
            }
        };

        await executeUpload(nextTask);

        set({ isUploading: false });
        get().processQueue(); // Process next in queue
    },
}));
