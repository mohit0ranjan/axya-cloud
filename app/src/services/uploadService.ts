import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import apiClient, { uploadClient } from './apiClient';

const CHUNK_SIZE = 5 * 1024 * 1024; // 5MB

export interface FileAsset {
    uri: string;
    name: string;
    size: number;
    mimeType?: string;
}

export type ProgressCallback = (progress: number) => void;

export const uploadFile = async (
    file: FileAsset,
    folderId: string | null,
    chatTarget: string = 'me',
    onProgress: ProgressCallback,
    isCancelled: () => boolean
) => {
    const { uri, name, size, mimeType } = file;
    const originalname = name;
    const mimetype = mimeType || 'application/octet-stream';

    // 1. Initialize
    const initRes = await uploadClient.post('/files/upload/init', {
        originalname,
        size,
        mimetype,
        telegram_chat_id: chatTarget,
        folder_id: folderId
    });
    const { uploadId } = initRes.data;

    let offset = 0;
    let chunkIndex = 0;

    // 2. Upload chunks
    if (Platform.OS === 'web') {
        const blobResponse = await fetch(uri);
        const blob = await blobResponse.blob();

        while (offset < size) {
            if (isCancelled()) throw new Error('Cancelled');

            const chunk = blob.slice(offset, offset + CHUNK_SIZE);
            const formData = new FormData();
            formData.append('uploadId', uploadId);
            formData.append('chunkIndex', String(chunkIndex));
            formData.append('chunk', new File([chunk], originalname, { type: mimetype }));

            await uploadClient.post('/files/upload/chunk', formData);
            offset += CHUNK_SIZE;
            chunkIndex++;
            onProgress(Math.min((offset / size) * 50, 50));
        }
    } else {
        while (offset < size) {
            if (isCancelled()) throw new Error('Cancelled');

            const length = Math.min(CHUNK_SIZE, size - offset);
            const chunkBase64 = await FileSystem.readAsStringAsync(uri, {
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
            onProgress(Math.min((offset / size) * 45, 45)); // 45% for app->server
        }
    }

    // 3. Complete server-side upload
    if (isCancelled()) throw new Error('Cancelled');
    onProgress(50);
    await uploadClient.post('/files/upload/complete', { uploadId });

    // 4. Poll for Telegram status
    return new Promise<void>((resolve, reject) => {
        const timer = setInterval(async () => {
            if (isCancelled()) {
                clearInterval(timer);
                reject(new Error('Cancelled'));
                return;
            }

            try {
                const statusRes = await apiClient.get(`/files/upload/status/${uploadId}`);
                const state = statusRes.data;

                if (state.status === 'completed') {
                    clearInterval(timer);
                    onProgress(100);
                    resolve();
                } else if (state.status === 'error') {
                    clearInterval(timer);
                    reject(new Error(state.error || 'Telegram upload failed'));
                } else {
                    // Update progress (50% to 100% range)
                    const telegramProgress = state.progress || 0;
                    onProgress(50 + (telegramProgress * 0.5));
                }
            } catch (e) {
                // Ignore transient errors while polling
                console.warn('[Upload] Poll error:', e);
            }
        }, 2000);
    });
};
