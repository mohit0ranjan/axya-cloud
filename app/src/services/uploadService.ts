/**
 * uploadService.ts — Standalone upload helper (used outside the queue)
 *
 * ✅ expo-file-system SDK 55 new API only — no deprecated APIs
 * ✅ File.open() + FileHandle.readBytes() for chunk reads
 * ✅ File.md5 for hash (no getInfoAsync)
 * ✅ Full cancellation support via isCancelled() callback + AbortSignal
 */

import { File } from 'expo-file-system';
import { Platform } from 'react-native';
import { Buffer } from 'buffer';
import apiClient, { uploadClient } from './apiClient';

const CHUNK_SIZE = 5 * 1024 * 1024; // 5 MB

export interface FileAsset {
    uri: string;
    name: string;
    size: number;
    mimeType?: string;
}

export type ProgressCallback = (progress: number, bytesUploaded: number) => void;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function uint8ArrayToBase64(bytes: Uint8Array): string {
    return Buffer.from(bytes).toString('base64');
}

/**
 * Read `length` bytes from a file URI starting at `offset`, returns Base64.
 * Uses File + FileHandle (new SDK 55 API) for file:// URIs.
 * Falls back to fetch() + Range header for content:// URIs.
 */
async function readFileChunkAsBase64(
    uri: string,
    offset: number,
    length: number
): Promise<string> {
    if (uri.startsWith('file://')) {
        try {
            const fileObj = new File(uri);
            const handle = fileObj.open();
            handle.offset = offset;
            const chunk = handle.readBytes(length);
            handle.close();
            return uint8ArrayToBase64(chunk);
        } catch (e) {
            console.warn('[uploadService] FileHandle failed, using fetch fallback:', e);
        }
    }

    const response = await fetch(uri, {
        headers: { Range: `bytes=${offset}-${offset + length - 1}` },
    });
    if (!response.ok && response.status !== 206 && response.status !== 200) {
        throw new Error(`Failed to read file chunk (HTTP ${response.status})`);
    }
    const buffer = await response.arrayBuffer();
    return uint8ArrayToBase64(new Uint8Array(buffer));
}

// ─── Main export ──────────────────────────────────────────────────────────────

export const uploadFile = async (
    file: FileAsset,
    folderId: string | null,
    chatTarget: string = 'me',
    onProgress: ProgressCallback,
    isCancelled: () => boolean,
    abortSignal?: AbortSignal
): Promise<void> => {
    const { uri, name, size, mimeType } = file;
    const mimetype = mimeType || 'application/octet-stream';

    const throwIfCancelled = () => {
        if (isCancelled() || abortSignal?.aborted) throw new Error('Cancelled');
    };

    // ── Step 1: Hash ──────────────────────────────────────────────────────
    let fileHash = '';
    if (Platform.OS !== 'web') {
        try {
            const fileObj = new File(uri);
            fileHash = fileObj.md5 ?? '';
        } catch { /* optional */ }
    }

    throwIfCancelled();

    // ── Step 2: Init ──────────────────────────────────────────────────────
    const initRes = await uploadClient.post(
        '/files/upload/init',
        { originalname: name, size, mimetype, telegram_chat_id: chatTarget, folder_id: folderId, hash: fileHash },
        { signal: abortSignal }
    );

    if (initRes.data.duplicate) {
        onProgress(100, size);
        return;
    }

    const { uploadId } = initRes.data;
    let offset = 0;
    let chunkIndex = 0;

    // ── Step 3: Chunks ────────────────────────────────────────────────────
    if (Platform.OS === 'web') {
        const blobResp = await fetch(uri);
        const blob = await blobResp.blob();

        while (offset < size) {
            throwIfCancelled();
            const chunk = blob.slice(offset, offset + CHUNK_SIZE);
            const formData = new FormData();
            formData.append('uploadId', uploadId);
            formData.append('chunkIndex', String(chunkIndex));
            formData.append('chunk', new globalThis.File([chunk], name, { type: mimetype }));

            await uploadClient.post('/files/upload/chunk', formData, { signal: abortSignal });
            offset = Math.min(offset + CHUNK_SIZE, size);
            chunkIndex++;
            onProgress(Math.round(Math.min((offset / size) * 45, 45)), offset);
        }
    } else {
        while (offset < size) {
            throwIfCancelled();
            const length = Math.min(CHUNK_SIZE, size - offset);
            const chunkBase64 = await readFileChunkAsBase64(uri, offset, length);
            throwIfCancelled();

            await uploadClient.post(
                '/files/upload/chunk',
                { uploadId, chunkIndex, chunkBase64 },
                { signal: abortSignal }
            );

            offset += length;
            chunkIndex++;
            onProgress(Math.round(Math.min((offset / size) * 45, 45)), offset);
        }
    }

    throwIfCancelled();
    onProgress(50, size);

    // ── Step 4: Complete ──────────────────────────────────────────────────
    await uploadClient.post('/files/upload/complete', { uploadId }, { signal: abortSignal });

    // ── Step 5: Poll ──────────────────────────────────────────────────────
    // ✅ Fix 5: Recursive setTimeout prevents overlapping poll requests
    await new Promise<void>((resolve, reject) => {
        const maxWait = Date.now() + 10 * 60 * 1000;

        const poll = async () => {
            if (isCancelled() || abortSignal?.aborted || Date.now() > maxWait) {
                reject(new Error(Date.now() > maxWait ? 'Upload timed out' : 'Cancelled'));
                return;
            }

            try {
                const res = await apiClient.get(`/files/upload/status/${uploadId}`, { signal: abortSignal });
                const { status, progress: tgProgress, error: tgError } = res.data;

                if (status === 'completed') {
                    onProgress(100, size);
                    resolve();
                    return;
                } else if (status === 'error') {
                    reject(new Error(tgError || 'Telegram upload failed'));
                    return;
                } else {
                    onProgress(Math.round(50 + ((tgProgress || 0) * 0.5)), size * 0.5);
                }
            } catch (e: any) {
                if (e.name === 'CanceledError' || e.name === 'AbortError') {
                    reject(new Error('Cancelled'));
                    return;
                }
                if (e.response?.status === 404 || e.response?.status === 403) {
                    reject(new Error(e.response?.data?.error || `Upload fatal error ${e.response?.status}`));
                    return;
                }
                // Transient poll errors → keep polling
            }

            setTimeout(poll, 2000);
        };

        abortSignal?.addEventListener('abort', () => {
            reject(new Error('Cancelled'));
        });

        poll(); // Start loop
    });
};
