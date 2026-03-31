import fs from 'fs';
import path from 'path';
import os from 'os';
import { finished } from 'stream/promises';
import pool from '../../config/db';
import { getDynamicClient } from '../../services/telegram.service';
import { getStorageAdapter } from '../../services/storage/telegram-storage.adapter';
import { enqueueUploadFinalizerJob, isUploadFinalizerTracked } from '../../services/upload-job-queue.service';
import { logger } from '../../utils/logger';
import sharp from 'sharp';
import { encode } from 'blurhash';

import { toInt, logUploadStage, classifyUploadFailure, computeFileHashes, computePartialFileSha256 } from './upload.helpers';
import { getUploadSessionById, getChunkStats, updateSessionFailure } from './upload.session';
import { getCapacitySnapshot } from './upload.capacity';
import { promoteQueuedSessionsIfCapacity } from './upload.queue';
import { cleanupSessionTempFile } from './upload.temp';
import {
    activeFinalizers,
    pendingFinalizerRetries,
    finalizerAttemptByUploadId,
    telegramSemaphore,
    thumbnailSemaphore,
    FINALIZER_RETRY_BASE_MS,
    FINALIZER_RETRY_MAX_MS,
    FINALIZER_MAX_RETRIES,
    FINALIZER_PROGRESS_UPDATE_THROTTLE_MS,
    LARGE_FILE_PARTIAL_HASH_THRESHOLD_BYTES,
    PARTIAL_HASH_SAMPLE_BYTES,
} from './upload.types';

// ─── Retry helpers ──────────────────────────────────────────────────────────

const getFinalizerBackoffMs = (attempt: number) => {
    const safeAttempt = Math.max(1, attempt);
    const exponential = Math.min(FINALIZER_RETRY_MAX_MS, FINALIZER_RETRY_BASE_MS * Math.pow(2, safeAttempt - 1));
    const jitter = Math.floor(Math.random() * Math.max(250, Math.floor(exponential * 0.2)));
    return Math.min(FINALIZER_RETRY_MAX_MS, exponential + jitter);
};

export const clearFinalizerRetryState = (uploadId: string) => {
    const timer = pendingFinalizerRetries.get(uploadId);
    if (timer) {
        clearTimeout(timer);
        pendingFinalizerRetries.delete(uploadId);
    }
    finalizerAttemptByUploadId.delete(uploadId);
};

const queueRetryableFinalizerFailure = async (uploadId: string, code: string, message: string) => {
    await pool.query(
        `UPDATE upload_sessions
         SET status = 'queued',
             error_code = $2,
             error_message = $3,
             retryable = true,
             updated_at = NOW()
         WHERE upload_id = $1 AND status IN ('processing', 'uploading', 'queued')`,
        [uploadId, code, message]
    );
};

const scheduleUploadFinalizerRetry = (uploadId: string, ownerSessionString: string, reason: string) => {
    if (FINALIZER_MAX_RETRIES <= 0) return;
    if (pendingFinalizerRetries.has(uploadId)) return;

    const currentAttempt = finalizerAttemptByUploadId.get(uploadId) || 0;
    const nextAttempt = currentAttempt + 1;
    if (nextAttempt > FINALIZER_MAX_RETRIES) {
        finalizerAttemptByUploadId.delete(uploadId);
        logger.error('backend.upload', 'finalizer_retry_exhausted', {
            uploadId,
            attempts: currentAttempt,
            reason,
        });
        return;
    }

    finalizerAttemptByUploadId.set(uploadId, nextAttempt);
    const delayMs = getFinalizerBackoffMs(nextAttempt);
    const timer = setTimeout(() => {
        pendingFinalizerRetries.delete(uploadId);
        startUploadFinalizer(uploadId, ownerSessionString);
    }, delayMs);
    timer.unref?.();
    pendingFinalizerRetries.set(uploadId, timer);

    logger.warn('backend.upload', 'finalizer_retry_scheduled', {
        uploadId,
        attempt: nextAttempt,
        maxAttempts: FINALIZER_MAX_RETRIES,
        delayMs,
        reason,
    });
};

// ─── Core finalizer ─────────────────────────────────────────────────────────

const finalizeUploadSession = async (uploadId: string, ownerSessionString: string) => {
    const release = await telegramSemaphore.acquire();
    try {
        const session = await getUploadSessionById(uploadId);
        if (!session) return;
        if (session.status === 'completed' || session.status === 'cancelled') return;
        if (session.status !== 'processing' && session.status !== 'uploading') return;

        const chunkStats = await getChunkStats(uploadId);
        const totalChunks = toInt(session.total_chunks);
        if (chunkStats.uploadedCount < totalChunks) {
            await updateSessionFailure(uploadId, 'missing_chunks', 'Upload is incomplete. Missing chunks before finalize.', true);
            return;
        }

        let tempStat: fs.Stats | null = null;
        try {
            tempStat = await fs.promises.stat(session.temp_file_path);
        } catch {
            tempStat = null;
        }

        if (!tempStat) {
            await updateSessionFailure(uploadId, 'temp_file_missing', 'Upload temp file missing during finalize.', false);
            return;
        }
        
        let finalFilePath = session.temp_file_path;
        if (tempStat.isDirectory()) {
            finalFilePath = `${session.temp_file_path}.assembled`;
            let assembledExists = false;
            try {
                await fs.promises.access(finalFilePath);
                assembledExists = true;
            } catch {
                assembledExists = false;
            }
            if (!assembledExists) {
                logger.info('backend.upload', 'assembling_chunks_start', { uploadId, totalChunks });
                const writeStream = fs.createWriteStream(finalFilePath);
                let assemblyFailed = false;
                try {
                    for (let i = 0; i < totalChunks; i++) {
                        const chunkPath = path.join(session.temp_file_path, `chunk_${i}.tmp`);
                        let chunkExists = false;
                        try {
                            await fs.promises.access(chunkPath);
                            chunkExists = true;
                        } catch {
                            chunkExists = false;
                        }
                        if (!chunkExists) {
                            assemblyFailed = true;
                            writeStream.close();
                            try { await fs.promises.rm(finalFilePath, { force: true }); } catch {}
                            await updateSessionFailure(uploadId, 'chunk_file_missing', `Chunk ${i} is missing from disk`, true);
                            return;
                        }
                        await new Promise<void>((resolve, reject) => {
                            const rs = fs.createReadStream(chunkPath);
                            rs.pipe(writeStream, { end: false });
                            rs.on('end', resolve);
                            rs.on('error', reject);
                        });
                    }
                    writeStream.end();
                    await finished(writeStream);
                    logger.info('backend.upload', 'assembling_chunks_done', { uploadId });
                } catch (assembleErr: any) {
                    assemblyFailed = true;
                    writeStream.close();
                    try { await fs.promises.rm(finalFilePath, { force: true }); } catch {}
                    await updateSessionFailure(uploadId, 'chunk_assembly_failed', 'Failed to assemble chunks', true);
                    return;
                }
                if (assemblyFailed) return;
            }
            session.temp_file_path = finalFilePath; // override for all downstream logic
        }

        const { sha256: serverHash, md5: serverMd5 } = await computeFileHashes(session.temp_file_path);
        const partialHash = toInt(session.total_bytes) >= LARGE_FILE_PARTIAL_HASH_THRESHOLD_BYTES
            ? await computePartialFileSha256(session.temp_file_path, toInt(session.total_bytes), PARTIAL_HASH_SAMPLE_BYTES)
            : serverHash;

        const preCheck = await pool.query(
            `SELECT * FROM files WHERE (sha256_hash = $1 OR md5_hash = $2) AND user_id = $3 AND is_trashed = false LIMIT 1`,
            [serverHash, serverMd5, session.user_id]
        );
        if (preCheck.rows.length > 0) {
            const reused = preCheck.rows[0];
            await pool.query(
                `UPDATE upload_sessions
                 SET status = 'completed',
                     file_id = $2,
                     file_sha256 = $3,
                     file_md5 = $4,
                     telegram_progress_percent = 100,
                     received_bytes = total_bytes,
                     uploaded_chunks = $5::jsonb,
                     error_code = NULL,
                     error_message = NULL,
                     retryable = false,
                     updated_at = NOW(),
                     completed_at = NOW()
                 WHERE upload_id = $1`,
                [uploadId, reused.id, serverHash, serverMd5, JSON.stringify(chunkStats.uploadedChunks)]
            );
            cleanupSessionTempFile(session.temp_file_path);
            logger.info('backend.upload', 'upload_completed', {
                uploadId,
                userId: session.user_id,
                deduped: true,
                fileId: reused.id,
            });
            finalizerAttemptByUploadId.delete(uploadId);
            return;
        }

        const storageAdapter = getStorageAdapter();

        let lastProgressWriteAt = 0;
        let lastProgressValue = 0;
        const progressCallback = (progress: number) => {
            const next = Math.min(Math.max(Math.round(progress * 100), 0), 100);
            const now = Date.now();
            if (next === lastProgressValue && now - lastProgressWriteAt < FINALIZER_PROGRESS_UPDATE_THROTTLE_MS) return;
            if (now - lastProgressWriteAt < FINALIZER_PROGRESS_UPDATE_THROTTLE_MS && next < 100) return;
            lastProgressValue = next;
            lastProgressWriteAt = now;
            void pool.query(
                `UPDATE upload_sessions
                 SET telegram_progress_percent = $2, updated_at = NOW()
                 WHERE upload_id = $1 AND status = 'processing'`,
                [uploadId, next]
            ).catch(() => undefined);
        };

        const uploadedFile = await storageAdapter.uploadFile({
            ownerSessionString,
            requestedChatId: String(session.telegram_chat_id || 'me'),
            filePath: session.temp_file_path,
            fileName: session.file_name,
            fileSize: toInt(session.total_bytes),
            mimeType: session.mime_type || 'application/octet-stream',
            caption: `[Axya] ${session.file_name}`,
            onProgress: progressCallback,
        });

        // Fix #1: Immediately re-check session status after Telegram upload.
        const latestSession = await getUploadSessionById(uploadId);
        if (!latestSession || latestSession.status === 'cancelled') {
            try {
                const tgMsgId = toInt(uploadedFile.providerMessageId);
                if (uploadedFile.provider === 'telegram' && tgMsgId > 0 && uploadedFile.providerContext?.session) {
                    const cleanupClient = await getDynamicClient(uploadedFile.providerContext.session);
                    await cleanupClient.deleteMessages(uploadedFile.storageChatId, [tgMsgId], { revoke: true });
                    logger.info('backend.upload', 'orphan_telegram_message_deleted', {
                        uploadId,
                        telegramMessageId: tgMsgId,
                        chatId: uploadedFile.storageChatId,
                        reason: 'cancelled_during_telegram_upload',
                    });
                }
            } catch (deleteErr: any) {
                logger.warn('backend.upload', 'orphan_telegram_message_delete_failed', {
                    uploadId,
                    telegramMessageId: uploadedFile.providerMessageId,
                    message: deleteErr?.message,
                });
            }
            cleanupSessionTempFile(session.temp_file_path);
            await promoteQueuedSessionsIfCapacity();
            finalizerAttemptByUploadId.delete(uploadId);
            return;
        }

        const messageId = toInt(uploadedFile.providerMessageId);
        const telegramFileId = uploadedFile.providerFileId;
        const nativeMeta = uploadedFile.nativeMeta;

        let finalBlurhash: string | null = null;
        let finalThumbBuffer: Buffer | null = null;
        if ((session.mime_type || '').startsWith('image/') && toInt(session.total_bytes) < 20 * 1024 * 1024) {
            try {
                const releaseThumb = await thumbnailSemaphore.acquire();
                try {
                    const image = sharp(session.temp_file_path);
                    const metadata = await image.metadata();
                    if (metadata.width && metadata.height) {
                        const { data, info } = await sharp(session.temp_file_path)
                            .raw()
                            .ensureAlpha()
                            .resize(32, 32, { fit: 'inside' })
                            .toBuffer({ resolveWithObject: true });
                        finalBlurhash = encode(new Uint8ClampedArray(data), info.width, info.height, 4, 3);
                        finalThumbBuffer = await sharp(session.temp_file_path, { failOnError: false })
                            .resize(300, 300, { fit: 'inside', withoutEnlargement: true })
                            .toFormat('webp', { quality: 70, effort: 3 })
                            .toBuffer();
                    }
                } finally {
                    releaseThumb();
                }
            } catch (thumbErr: any) {
                logger.warn('backend.upload', 'thumb_generation_failed', {
                    uploadId,
                    message: thumbErr?.message,
                });
            }
        }

        let fileRow: any = null;
        let isOrphanedRace = false;

        const insertResult = await pool.query(
            `INSERT INTO files (user_id, folder_id, file_name, file_size, telegram_file_id, telegram_message_id, telegram_chat_id, mime_type, sha256_hash, md5_hash, partial_sha256, blurhash, tg_media_meta, tg_duration_sec, tg_width, tg_height, tg_caption, tg_source_tag)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb, $14, $15, $16, $17, $18)
             ON CONFLICT (user_id, sha256_hash) WHERE sha256_hash IS NOT NULL AND is_trashed = false
             DO NOTHING
             RETURNING *`,
            [
                session.user_id,
                session.folder_id,
                session.file_name,
                toInt(session.total_bytes),
                telegramFileId,
                messageId,
                uploadedFile.storageChatId,
                session.mime_type || 'application/octet-stream',
                serverHash,
                serverMd5,
                partialHash,
                finalBlurhash,
                JSON.stringify(nativeMeta.mediaMeta || {}),
                nativeMeta.durationSec,
                nativeMeta.width,
                nativeMeta.height,
                nativeMeta.caption,
                session.source_tag,
            ]
        );

        if (insertResult.rows.length > 0) {
            fileRow = insertResult.rows[0];
        } else {
            const existingRes = await pool.query(
                `SELECT * FROM files WHERE user_id = $1 AND sha256_hash = $2 AND is_trashed = false LIMIT 1`,
                [session.user_id, serverHash]
            );
            if (existingRes.rows.length > 0) {
                fileRow = existingRes.rows[0];
                isOrphanedRace = true;
            }
        }

        if (isOrphanedRace && uploadedFile.provider === 'telegram' && messageId > 0 && uploadedFile.providerContext?.session) {
            try {
                const cleanupClient = await getDynamicClient(uploadedFile.providerContext.session);
                await cleanupClient.deleteMessages(uploadedFile.storageChatId, [messageId], { revoke: true });
                logger.info('backend.upload', 'orphan_telegram_message_deleted', {
                    uploadId,
                    telegramMessageId: messageId,
                    chatId: uploadedFile.storageChatId,
                    reason: 'race_condition_duplicate',
                });
            } catch (deleteErr: any) {
                logger.warn('backend.upload', 'orphan_telegram_message_delete_failed', {
                    uploadId,
                    telegramMessageId: messageId,
                    message: deleteErr?.message,
                });
            }
        }

        if (fileRow && finalThumbBuffer) {
            try {
                const thumbDir = path.join(os.tmpdir(), 'axya_thumbs');
                await fs.promises.mkdir(thumbDir, { recursive: true });
                await fs.promises.writeFile(path.join(thumbDir, `${fileRow.id}.webp`), finalThumbBuffer);
                await fs.promises.writeFile(path.join(thumbDir, `${fileRow.id}_300.webp`), finalThumbBuffer);
                try {
                    const microThumb = await sharp(finalThumbBuffer, { failOnError: false })
                        .resize(240, 240, { fit: 'inside', withoutEnlargement: true })
                        .toFormat('webp', { quality: 70, effort: 2 })
                        .toBuffer();
                    await fs.promises.writeFile(path.join(thumbDir, `${fileRow.id}_240.webp`), microThumb);
                } catch { /* micro-thumb generation is best-effort */ }
            } catch {
                // best effort thumbnail cache
            }
        }

        await pool.query(
            `UPDATE upload_sessions
             SET status = 'completed',
                 file_id = $2,
                 file_sha256 = $3,
                 file_md5 = $4,
                 telegram_progress_percent = 100,
                 received_bytes = total_bytes,
                 uploaded_chunks = $5::jsonb,
                 error_code = NULL,
                 error_message = NULL,
                 retryable = false,
                 updated_at = NOW(),
                 completed_at = NOW()
             WHERE upload_id = $1`,
            [uploadId, fileRow?.id || null, serverHash, serverMd5, JSON.stringify(chunkStats.uploadedChunks)]
        );

        cleanupSessionTempFile(session.temp_file_path);
        logger.info('backend.upload', 'upload_completed', {
            uploadId,
            userId: session.user_id,
            fileId: fileRow?.id || null,
        });
        finalizerAttemptByUploadId.delete(uploadId);
        await promoteQueuedSessionsIfCapacity();
    } catch (err: any) {
        const mapped = classifyUploadFailure(err);
        if (mapped.retryable) {
            await queueRetryableFinalizerFailure(uploadId, mapped.code, mapped.message);
            throw Object.assign(new Error(mapped.message), {
                code: mapped.code,
                retryable: true,
            });
        }

        await updateSessionFailure(uploadId, mapped.code, mapped.message, mapped.retryable);
        logger.error('backend.upload', 'upload_failed', {
            uploadId,
            message: (err as any)?.message,
            stack: (err as any)?.stack,
            code: mapped.code,
            retryable: mapped.retryable,
        });
        await promoteQueuedSessionsIfCapacity();
    } finally {
        release();
    }
};

// ─── Finalizer lifecycle ────────────────────────────────────────────────────

export const startUploadFinalizer = (uploadId: string, ownerSessionString: string) => {
    if (activeFinalizers.has(uploadId) || pendingFinalizerRetries.has(uploadId) || isUploadFinalizerTracked(uploadId)) return;

    const queued = enqueueUploadFinalizerJob(uploadId, async () => {
        await finalizeUploadSession(uploadId, ownerSessionString);
    });
    if (!queued) {
        logUploadStage('finalizer_enqueue_skipped', {
            uploadId,
            reason: 'already_tracked_or_invalid',
            activeFinalizers: activeFinalizers.size,
            pendingRetries: pendingFinalizerRetries.size,
        });
        return;
    }

    logUploadStage('finalizer_enqueued', {
        uploadId,
        activeFinalizers: activeFinalizers.size,
        pendingRetries: pendingFinalizerRetries.size,
    });

    const promise = queued
        .catch((err: any) => {
            logger.error('backend.upload', 'finalizer_crashed', {
                uploadId,
                message: err?.message,
                stack: err?.stack,
            });

            if (Boolean(err?.retryable)) {
                scheduleUploadFinalizerRetry(uploadId, ownerSessionString, String(err?.code || err?.message || 'retryable_failure'));
            } else {
                clearFinalizerRetryState(uploadId);
            }
        })
        .finally(() => {
            activeFinalizers.delete(uploadId);
        });

    activeFinalizers.set(uploadId, promise);
};

export const recoverActiveFinalizers = async () => {
    const rows = await pool.query(
        `SELECT us.upload_id, u.session_string
         FROM upload_sessions us
         JOIN users u ON u.id = us.user_id
         WHERE us.status = 'processing'
         ORDER BY us.updated_at ASC
         LIMIT 50`
    );

    let scheduled = 0;
    for (const row of rows.rows) {
        const uploadId = String(row.upload_id || '').trim();
        const ownerSessionString = String(row.session_string || '').trim();
        if (!uploadId || !ownerSessionString) continue;
        if (activeFinalizers.has(uploadId) || pendingFinalizerRetries.has(uploadId) || isUploadFinalizerTracked(uploadId)) continue;
        scheduled += 1;
        startUploadFinalizer(uploadId, ownerSessionString);
    }

    if (scheduled > 0) {
        logger.info('backend.upload', 'recovered_processing_finalizers', { scheduled });
    }
};
