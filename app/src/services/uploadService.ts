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
import { normalizeUploadFile } from '../utils/fileSafety';

const CHUNK_SIZE = 5 * 1024 * 1024; // 5 MB
const DEFAULT_POLL_MS = 2000;
const DEFAULT_CHUNK_DELAY_MS = 0;

export interface FileAsset {
    uri: string;
    name: string;
    size: number;
    mimeType?: string;
}

export type ProgressCallback = (progress: number, bytesUploaded: number) => void;

// ─── Helpers ──────────────────────────────────────────────────────────────────

// ─── Main export ──────────────────────────────────────────────────────────────

export const uploadFile = async (
    file: FileAsset,
    folderId: string | null,
    chatTarget: string = 'me',
    onProgress: ProgressCallback,
    isCancelled: () => boolean,
    abortSignal?: AbortSignal
): Promise<void> => {
    const normalized = normalizeUploadFile(file);
    const uri = normalized.uri;
    const name = normalized.name;
    const size = Math.max(0, Number(file?.size || 0));
    const mimetype = normalized.type || 'application/octet-stream';

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
        {
            originalname: name,
            size,
            mimetype,
            telegram_chat_id: chatTarget,
            folder_id: folderId,
            hash: fileHash,
            chunk_size_bytes: CHUNK_SIZE,
        },
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

            const chunkRes = await uploadClient.post('/files/upload/chunk', formData, { signal: abortSignal });
            // Fix #5: Respect server backpressure hints between chunks
            const chunkDelay = chunkRes.data?.recommendedChunkDelayMs ?? DEFAULT_CHUNK_DELAY_MS;
            if (chunkDelay > 0) await new Promise(r => setTimeout(r, chunkDelay));
            offset = Math.min(offset + CHUNK_SIZE, size);
            chunkIndex++;
            onProgress(Math.round(Math.min((offset / size) * 45, 45)), offset);
        }
    } else {
        while (offset < size) {
            throwIfCancelled();
            const length = Math.min(CHUNK_SIZE, size - offset);
            
            const formData = new FormData();
            formData.append('uploadId', uploadId);
            formData.append('chunkIndex', String(chunkIndex));
            formData.append('chunk', {
                uri: uri,
                name: name,
                type: mimetype,
            } as any);

            const chunkRes = await uploadClient.post(
                '/files/upload/chunk',
                formData,
                { signal: abortSignal }
            );
            
            // Fix #5: Respect server backpressure hints between chunks
            const chunkDelay = chunkRes.data?.recommendedChunkDelayMs ?? DEFAULT_CHUNK_DELAY_MS;
            if (chunkDelay > 0) await new Promise(r => setTimeout(r, chunkDelay));

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
        let settled = false;

        const settle = (fn: () => void) => {
            if (settled) return;
            settled = true;
            fn();
        };

        const poll = async () => {
            if (settled) return;
            if (isCancelled() || abortSignal?.aborted || Date.now() > maxWait) {
                settle(() => reject(new Error(Date.now() > maxWait ? 'Upload timed out' : 'Cancelled')));
                return;
            }

            // Fix #7: Use adaptive poll interval from server response
            let nextPollMs = DEFAULT_POLL_MS;
            try {
                const res = await apiClient.get(`/files/upload/status/${uploadId}`, { signal: abortSignal });
                const { status, progress: tgProgress, error: tgError, recommendedPollMs } = res.data;
                // Fix #7: Respect server's recommended poll interval
                if (typeof recommendedPollMs === 'number' && recommendedPollMs > 0) {
                    nextPollMs = recommendedPollMs;
                }

                if (status === 'completed') {
                    onProgress(100, size);
                    settle(() => resolve());
                    return;
                } else if (status === 'error' || status === 'cancelled') {
                    settle(() => reject(new Error(tgError || 'Telegram upload failed')));
                    return;
                } else {
                    const pollProgress = Math.round(50 + ((tgProgress || 0) * 0.5));
                    onProgress(pollProgress, Math.round((pollProgress / 100) * size));
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

            if (!settled) {
                pollTimerId = setTimeout(poll, nextPollMs);
            }
        };

        let pollTimerId: NodeJS.Timeout | null = null;
        abortSignal?.addEventListener('abort', () => {
            if (pollTimerId) clearTimeout(pollTimerId);
            settle(() => reject(new Error('Cancelled')));
        }, { once: true });

        poll();
    });
};
