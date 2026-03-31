import { Response } from 'express';
import { AuthRequest } from '../../middlewares/auth.middleware';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import pool from '../../config/db';
import { logger } from '../../utils/logger';
import { sendApiError } from '../../utils/apiError';
import { isAllowedUploadMime } from '../../utils/uploadMime';
import { resolveTelegramUploadTransport } from '../../services/storage/telegram-storage.adapter';
import { getUploadFinalizerQueueHealth, withUploadBandwidthBudget } from '../../services/upload-job-queue.service';

import { toInt, sanitizeUploadFileName, logUploadStage, computeNextExpectedChunk } from './upload.helpers';
import { getCapacitySnapshot, getAdaptiveConcurrencyLimits, getDiskUsageSnapshot, buildBackpressureHints } from './upload.capacity';
import {
    getOwnedUploadSession,
    getChunkStats,
    validateChunkManifestIntegrity,
    saveChunkMetricsToSession,
    updateSessionFailure,
    toUploadStatusPayload,
} from './upload.session';
import { promoteQueuedSessionsIfCapacity, getQueuePosition } from './upload.queue';
import { signUploadResumeToken, verifyUploadResumeToken, getResumeTokenFromRequest } from './upload.resume';
import { ensureTempUploadFile, cleanupSessionTempFile } from './upload.temp';
import { startUploadFinalizer, clearFinalizerRetryState } from './upload.finalizer';
import {
    UploadLifecycleStatus,
    UploadSessionRow,
    FIXED_CHUNK_SIZE_BYTES,
    MAX_FILE_SIZE_BYTES,
    MAX_PARALLEL_CHUNK_UPLOADS,
    MAX_ACTIVE_SESSION_FETCH,
    RESERVED_DISK_BYTES,
    LARGE_FILE_PARTIAL_HASH_THRESHOLD_BYTES,
    activeChunksByUploadId,
    activeFinalizers,
    pendingFinalizerRetries,
    finalizerAttemptByUploadId,
    chunkIndexLocks,
} from './upload.types';
import { formatFileRow } from '../../utils/formatters';

const pathExists = async (targetPath: string): Promise<boolean> => {
    try {
        await fs.promises.access(targetPath);
        return true;
    } catch {
        return false;
    }
};

const removeFileBestEffort = async (targetPath: string): Promise<void> => {
    if (!targetPath) return;
    try {
        await fs.promises.rm(targetPath, { force: true });
    } catch {
        // best effort cleanup
    }
};

// ─── List Sessions ──────────────────────────────────────────────────────────

export const listUploadSessions = async (req: AuthRequest, res: Response) => {
    if (!req.user) return sendApiError(res, 401, 'unauthorized', 'Unauthorized');
    const includeCompleted = String(req.query.include_completed || '').trim() === '1';

    const query = includeCompleted
        ? `SELECT * FROM upload_sessions WHERE user_id = $1 ORDER BY updated_at DESC LIMIT $2`
        : `SELECT *
           FROM upload_sessions
           WHERE user_id = $1
             AND (status IN ('queued', 'uploading', 'processing', 'paused', 'failed', 'cancelled') OR updated_at > NOW() - INTERVAL '24 hours')
           ORDER BY updated_at DESC
           LIMIT $2`;

    const sessionsRes = await pool.query(query, [req.user.id, MAX_ACTIVE_SESSION_FETCH]);
    const capacity = await getCapacitySnapshot(req.user.id);
    const payload = await Promise.all(
        sessionsRes.rows.map((row: any) => toUploadStatusPayload(row as UploadSessionRow, capacity))
    );

    return res.json({ success: true, sessions: payload });
};

// ─── Step 1: Init Upload ────────────────────────────────────────────────────

export const initUpload = async (req: AuthRequest, res: Response) => {
    if (!req.user) return sendApiError(res, 401, 'unauthorized', 'Unauthorized');

    const { originalname, size, mimetype, folder_id, telegram_chat_id, hash, partial_hash, source_tag, chunk_size_bytes } = req.body;

    if (!originalname || size === undefined || size === null) {
        return sendApiError(res, 400, 'invalid_request', 'Missing file info (originalname, size required)', { retryable: false });
    }

    const fileName = sanitizeUploadFileName(String(originalname));
    const fileSize = toInt(size);
    if (fileSize <= 0) {
        return sendApiError(res, 400, 'invalid_file_size', 'File size must be greater than 0 bytes');
    }

    if (fileSize > MAX_FILE_SIZE_BYTES) {
        return sendApiError(
            res,
            413,
            'file_too_large',
            `File size exceeds supported upload limit.`,
            { retryable: false, details: { maxBytes: MAX_FILE_SIZE_BYTES } }
        );
    }

    const normalizedMime = String(mimetype || '').trim().toLowerCase();
    if (!isAllowedUploadMime(normalizedMime)) {
        return sendApiError(
            res,
            400,
            'unsupported_mime_type',
            `File type '${normalizedMime || 'unknown'}' is not permitted.`,
            { retryable: false }
        );
    }

    if (chunk_size_bytes !== undefined && chunk_size_bytes !== null) {
        const requestedChunkSize = toInt(chunk_size_bytes);
        if (requestedChunkSize > 0 && requestedChunkSize !== FIXED_CHUNK_SIZE_BYTES) {
            return sendApiError(
                res,
                400,
                'chunk_size_fixed',
                `Chunk size must be exactly ${FIXED_CHUNK_SIZE_BYTES} bytes.`,
                { retryable: false }
            );
        }
    }

    const chunkSize = FIXED_CHUNK_SIZE_BYTES;
    const totalChunks = Math.max(1, Math.ceil(fileSize / chunkSize));

    // Check storage quota BEFORE connecting to Telegram
    const quotaCheckEnabled = process.env.STORAGE_QUOTA_ENABLED === 'true';
    if (quotaCheckEnabled) {
        try {
            const quotaCheck = await pool.query(
                'SELECT storage_used_bytes, storage_quota_bytes FROM users WHERE id = $1',
                [req.user.id]
            );
            if (quotaCheck.rows.length > 0) {
                const { storage_used_bytes, storage_quota_bytes } = quotaCheck.rows[0];
                if (toInt(storage_used_bytes) + fileSize > toInt(storage_quota_bytes)) {
                    return res.status(413).json({
                        success: false,
                        error: 'Storage quota exceeded.',
                        code: 'QUOTA_EXCEEDED',
                    });
                }
            }
        } catch (quotaErr: any) {
            logger.warn('backend.upload', 'quota_check_failed', {
                userId: req.user.id,
                message: quotaErr?.message,
            });
        }
    }

    let uploadTransport: { session: string; chatId: string };
    try {
        uploadTransport = await resolveTelegramUploadTransport(req.user.sessionString, telegram_chat_id);
    } catch (sessionErr: any) {
        const msg = sessionErr?.message || 'Telegram session invalid';
        const isExpired = msg.includes('expired') || msg.includes('revoked');
        return sendApiError(
            res,
            503,
            'telegram_session_expired',
            isExpired ? 'Telegram session expired. Please re-login.' : msg,
            { retryable: false }
        );
    }

    let dedupeHint: { strategy: 'partial-hash'; fileId: string; fileName: string } | null = null;

    if (hash) {
        try {
            const hashValue = String(hash).trim();
            let existing;
            if (hashValue.length === 64) {
                existing = await pool.query(
                    `SELECT * FROM files WHERE sha256_hash = $1 AND user_id = $2 AND is_trashed = false LIMIT 1`,
                    [hashValue, req.user.id]
                );
            } else if (hashValue.length === 32) {
                existing = await pool.query(
                    `SELECT * FROM files WHERE md5_hash = $1 AND user_id = $2 AND is_trashed = false LIMIT 1`,
                    [hashValue, req.user.id]
                );
            } else {
                existing = await pool.query(
                    `SELECT * FROM files WHERE (sha256_hash = $1 OR md5_hash = $1) AND user_id = $2 AND is_trashed = false LIMIT 1`,
                    [hashValue, req.user.id]
                );
            }

            if (existing.rows.length > 0) {
                const existingFile = existing.rows[0];
                const effectiveFolderId = folder_id || null;
                if (effectiveFolderId && effectiveFolderId !== existingFile.folder_id) {
                    const newFileRes = await pool.query(
                        `INSERT INTO files (user_id, folder_id, file_name, file_size, telegram_file_id, telegram_message_id, telegram_chat_id, mime_type, sha256_hash, md5_hash, partial_sha256, blurhash, tg_media_meta, tg_duration_sec, tg_width, tg_height, tg_caption, tg_source_tag)
                         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb, $14, $15, $16, $17, $18)
                         RETURNING *`,
                        [
                            req.user.id,
                            effectiveFolderId,
                            existingFile.file_name,
                            existingFile.file_size,
                            existingFile.telegram_file_id,
                            existingFile.telegram_message_id,
                            existingFile.telegram_chat_id,
                            existingFile.mime_type,
                            existingFile.sha256_hash,
                            existingFile.md5_hash,
                            existingFile.partial_sha256 || null,
                            existingFile.blurhash || null,
                            JSON.stringify(existingFile.tg_media_meta || {}),
                            existingFile.tg_duration_sec || null,
                            existingFile.tg_width || null,
                            existingFile.tg_height || null,
                            existingFile.tg_caption || null,
                            existingFile.tg_source_tag || null,
                        ]
                    );
                    return res.json({
                        success: true,
                        duplicate: true,
                        file: formatFileRow(newFileRes.rows[0]),
                        message: 'File already exists — reused from library',
                    });
                }

                return res.json({
                    success: true,
                    duplicate: true,
                    file: formatFileRow(existingFile),
                    message: 'File already exists — skipped upload',
                });
            }
        } catch (hashCheckErr: any) {
            logger.warn('backend.upload', 'dedupe_hash_check_failed', {
                userId: req.user.id,
                fileName,
                message: hashCheckErr?.message,
            });
        }
    }

    const clientPartialHash = String(partial_hash || '').trim().toLowerCase();
    if (!hash && clientPartialHash && clientPartialHash.length === 64 && fileSize >= LARGE_FILE_PARTIAL_HASH_THRESHOLD_BYTES) {
        try {
            const partialCandidate = await pool.query(
                `SELECT id, file_name
                 FROM files
                 WHERE user_id = $1
                   AND file_size = $2
                   AND partial_sha256 = $3
                   AND is_trashed = false
                 LIMIT 1`,
                [req.user.id, fileSize, clientPartialHash]
            );
            if (partialCandidate.rows.length > 0) {
                dedupeHint = {
                    strategy: 'partial-hash',
                    fileId: String(partialCandidate.rows[0].id || ''),
                    fileName: String(partialCandidate.rows[0].file_name || ''),
                };
            }
        } catch (partialErr: any) {
            logger.warn('backend.upload', 'partial_hash_hint_failed', {
                userId: req.user.id,
                fileName,
                message: partialErr?.message,
            });
        }
    }

    const uploadId = crypto.randomUUID();
    let tempFilePath = '';
    try {
        await promoteQueuedSessionsIfCapacity();
        const capacity = await getCapacitySnapshot(req.user.id);
        const limits = getAdaptiveConcurrencyLimits(capacity);
        const disk = getDiskUsageSnapshot();
        const diskCannotFitNow = disk.availableBytes > 0 && (disk.availableBytes - RESERVED_DISK_BYTES) < fileSize;
        const shouldQueue = diskCannotFitNow
            || limits.diskPauseNewUploads
            || capacity.activeForUser >= Math.max(1, limits.perUserLimit)
            || capacity.activeGlobal >= Math.max(1, limits.globalLimit);
        const initialStatus: UploadLifecycleStatus = shouldQueue ? 'queued' : 'uploading';

        tempFilePath = ensureTempUploadFile(uploadId, fileName, fileSize, false);
        await pool.query(
            `INSERT INTO upload_sessions (
                upload_id, user_id, file_name, mime_type, folder_id, telegram_chat_id, source_tag, upload_protocol,
                total_bytes, chunk_size_bytes, total_chunks, uploaded_chunks, received_bytes,
                status, telegram_progress_percent, temp_file_path
            ) VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8,
                $9, $10, $11, $12::jsonb, 0,
                $13, 0, $14
            )`,
            [
                uploadId,
                req.user.id,
                fileName,
                normalizedMime,
                folder_id || null,
                uploadTransport.chatId,
                String(source_tag || '').trim().toLowerCase() || null,
                'chunk',
                fileSize,
                chunkSize,
                totalChunks,
                JSON.stringify([]),
                initialStatus,
                tempFilePath,
            ]
        );

        const latestCapacity = await getCapacitySnapshot(req.user.id);
        const hints = buildBackpressureHints(initialStatus, latestCapacity);
        const queuePosition = initialStatus === 'queued'
            ? await getQueuePosition(uploadId, req.user.id)
            : { queuePositionGlobal: 0, queuePositionUser: 0 };

        logger.info('backend.upload', 'upload_started', {
            uploadId,
            userId: req.user.id,
            fileName,
            totalBytes: fileSize,
            chunkSize,
            totalChunks,
            uploadMode: 'chunk',
            queued: initialStatus === 'queued',
        });

        return res.json({
            success: true,
            uploadId,
            resumeToken: signUploadResumeToken(req.user.id, uploadId),
            duplicate: false,
            status: initialStatus,
            uploadMode: 'chunk',
            queued: initialStatus === 'queued',
            parallelChunkUploads: true,
            maxParallelChunkUploads: MAX_PARALLEL_CHUNK_UPLOADS,
            chunkSizeBytes: chunkSize,
            totalChunks,
            queuePositionGlobal: queuePosition.queuePositionGlobal,
            queuePositionUser: queuePosition.queuePositionUser,
            dedupeHint,
            ...hints,
        });
    } catch (err: any) {
        if (tempFilePath) cleanupSessionTempFile(tempFilePath);
        logger.error('backend.upload', 'upload_init_failed', {
            userId: req.user.id,
            fileName,
            message: err?.message,
            stack: err?.stack,
        });
        return sendApiError(res, 500, 'internal_error', 'Could not initialize upload session');
    }
};

// ─── Step 2: Upload Chunk (multipart-only, streaming persist) ───────────────

export const uploadChunk = async (req: AuthRequest, res: Response) => {
    if (!req.user) return sendApiError(res, 401, 'unauthorized', 'Unauthorized');

    const uploadId = String(req.body.uploadId || '').trim();
    const chunkIndex = toInt(req.body.chunkIndex);
    const clientChunkHash = String(req.body.chunkHash || '').trim().toLowerCase();
    const chunkBase64 = String(req.body.chunkBase64 || '').trim();

    if (!uploadId) return sendApiError(res, 400, 'missing_upload_id', 'Missing uploadId');
    if (!req.file) {
        if (!chunkBase64) {
            return sendApiError(res, 400, 'invalid_request', 'No chunk data provided. Use multipart/form-data with field name "chunk" or include chunkBase64.', { retryable: false });
        }
    }

    let session = await getOwnedUploadSession(uploadId, req.user.id);
    if (!session) {
        return sendApiError(res, 404, 'upload_not_found', 'Upload session not found');
    }

    if (session.status === 'completed') {
        const payload = await toUploadStatusPayload(session);
        return res.json(payload);
    }
    if (session.status === 'queued') {
        const capacity = await getCapacitySnapshot(req.user.id);
        const hints = buildBackpressureHints('queued', capacity);
        const queuePosition = await getQueuePosition(uploadId, req.user.id);
        return res.status(409).json({
            success: false,
            status: 'queued',
            code: 'UPLOAD_QUEUED',
            error: 'Upload is queued. Please retry after the recommended delay.',
            retryable: true,
            queuePositionGlobal: queuePosition.queuePositionGlobal,
            queuePositionUser: queuePosition.queuePositionUser,
            ...hints,
        });
    }
    if (session.status === 'paused') {
        return sendApiError(res, 409, 'UPLOAD_PAUSED', 'Upload is paused. Resume before sending more chunks.', { retryable: true });
    }
    if (session.status === 'cancelled') {
        return sendApiError(res, 409, 'UPLOAD_CANCELLED', 'Upload has been cancelled');
    }
    if (session.status === 'processing') {
        const capacity = await getCapacitySnapshot(req.user.id);
        return res.status(409).json({
            success: false,
            error: 'Upload is already processing.',
            code: 'UPLOAD_PROCESSING',
            retryable: true,
            ...buildBackpressureHints('processing', capacity),
        });
    }
    if (session.status === 'failed') {
        return sendApiError(res, 409, 'UPLOAD_FAILED', 'Upload is in failed state. Restart required.', { retryable: false });
    }

    const chunkKey = `${uploadId}:${chunkIndex}`;
    if (chunkIndexLocks.has(chunkKey)) {
        if (req.file?.path) await removeFileBestEffort(req.file.path);
        return res.status(409).json({
            success: false,
            error: 'Chunk is currently being uploaded',
            code: 'CHUNK_RACE',
            retryable: true
        });
    }
    chunkIndexLocks.add(chunkKey);

    const inFlight = activeChunksByUploadId.get(uploadId) || 0;
    if (inFlight >= MAX_PARALLEL_CHUNK_UPLOADS) {
        chunkIndexLocks.delete(chunkKey);
        if (req.file?.path) await removeFileBestEffort(req.file.path);
        return res.status(429).json({
            success: false,
            code: 'CHUNK_PARALLEL_LIMIT',
            error: 'Too many parallel chunk uploads for this file.',
            retryable: true,
            maxParallelChunkUploads: MAX_PARALLEL_CHUNK_UPLOADS,
        });
    }
    activeChunksByUploadId.set(uploadId, inFlight + 1);

    try {
        const capacityBeforeChunk = await getCapacitySnapshot(req.user.id);
        const hintsBeforeChunk = buildBackpressureHints(session.status, capacityBeforeChunk);
        const adaptiveLimits = getAdaptiveConcurrencyLimits(capacityBeforeChunk);
        const shouldPauseForBackpressure = session.status === 'uploading'
            && (
                adaptiveLimits.diskCritical
                || (
                    hintsBeforeChunk.backpressure.level === 'high'
                    && (capacityBeforeChunk.activeGlobal >= Math.max(1, adaptiveLimits.globalLimit) || capacityBeforeChunk.queuedGlobal > 0)
                )
            );
        if (shouldPauseForBackpressure) {
            await pool.query(
                `UPDATE upload_sessions
                 SET status = 'queued', updated_at = NOW()
                 WHERE upload_id = $1 AND status = 'uploading'`,
                [uploadId]
            );
            const queuePosition = await getQueuePosition(uploadId, req.user.id);
            return res.status(409).json({
                success: false,
                status: 'queued',
                code: 'UPLOAD_QUEUED',
                error: 'Upload is temporarily queued while server load is high.',
                retryable: true,
                queuePositionGlobal: queuePosition.queuePositionGlobal,
                queuePositionUser: queuePosition.queuePositionUser,
                ...hintsBeforeChunk,
            });
        }

        const totalChunks = toInt(session.total_chunks);
        if (chunkIndex < 0 || chunkIndex >= totalChunks) {
            return sendApiError(res, 400, 'invalid_chunk_index', `chunkIndex out of range (0..${Math.max(totalChunks - 1, 0)})`, { retryable: false });
        }

        const totalBytes = toInt(session.total_bytes);
        const chunkSize = toInt(session.chunk_size_bytes) || FIXED_CHUNK_SIZE_BYTES;
        const expectedChunkLength = chunkIndex === totalChunks - 1
            ? Math.max(totalBytes - (chunkIndex * chunkSize), 0)
            : chunkSize;

        // Validate chunk via multer temp file — stream from disk, no full Buffer load
        const multerTempPath = req.file?.path || '';
        let actualChunkSize = 0;
        let chunkBuffer: Buffer | null = null;

        if (multerTempPath) {
            try {
                const stat = await fs.promises.stat(multerTempPath);
                actualChunkSize = stat.size;
            } catch {
                return sendApiError(res, 400, 'chunk_read_error', 'Chunk file could not be read');
            }
        } else {
            try {
                chunkBuffer = Buffer.from(chunkBase64, 'base64');
                actualChunkSize = chunkBuffer.length;
            } catch {
                return sendApiError(res, 400, 'chunk_read_error', 'Chunk payload could not be decoded');
            }
        }

        if (actualChunkSize !== expectedChunkLength) {
            logger.warn('backend.upload', 'chunk_length_mismatch', {
                uploadId,
                userId: req.user.id,
                chunkIndex,
                expectedChunkLength,
                actualChunkLength: actualChunkSize,
            });
            await removeFileBestEffort(multerTempPath);
            return res.status(422).json({
                success: false,
                error: `Chunk length mismatch for index ${chunkIndex}. Expected ${expectedChunkLength}, got ${actualChunkSize}`,
                code: 'CHUNK_LENGTH_MISMATCH',
            });
        }

        // Compute chunk hash by streaming from multer temp file
        const serverChunkHash = multerTempPath
            ? await new Promise<string>((resolve, reject) => {
                const hash = crypto.createHash('sha256');
                const stream = fs.createReadStream(multerTempPath);
                stream.on('data', (chunk) => hash.update(chunk));
                stream.on('end', () => resolve(hash.digest('hex')));
                stream.on('error', reject);
            })
            : crypto.createHash('sha256').update(chunkBuffer || Buffer.alloc(0)).digest('hex');

        if (clientChunkHash && clientChunkHash !== serverChunkHash) {
            await removeFileBestEffort(multerTempPath);
            return res.status(422).json({
                success: false,
                error: 'Chunk checksum mismatch',
                code: 'CHUNK_CHECKSUM_MISMATCH',
            });
        }

        const existingChunkRes = await pool.query(
            `SELECT chunk_hash_sha256, chunk_size_bytes
             FROM upload_session_chunks
             WHERE upload_id = $1 AND chunk_index = $2
             LIMIT 1`,
            [uploadId, chunkIndex]
        );

        if (existingChunkRes.rows.length > 0) {
            const existing = existingChunkRes.rows[0];
            const sameHash = String(existing.chunk_hash_sha256 || '') === serverChunkHash;
            const sameSize = toInt(existing.chunk_size_bytes) === actualChunkSize;
            await removeFileBestEffort(multerTempPath);
            if (!sameHash || !sameSize) {
                return res.status(409).json({
                    success: false,
                    error: `Conflicting retry for chunk ${chunkIndex}`,
                    code: 'CHUNK_CONFLICT',
                });
            }

            const stats = await getChunkStats(uploadId);
            const nextExpectedChunk = computeNextExpectedChunk(totalChunks, stats.uploadedChunks);
            const capacity = await getCapacitySnapshot(req.user.id);
            return res.json({
                success: true,
                duplicate: true,
                receivedBytes: stats.uploadedBytes,
                totalBytes,
                uploadedChunksCount: stats.uploadedCount,
                totalChunks,
                nextExpectedChunk,
                ...buildBackpressureHints(session.status, capacity),
            });
        }

        if (!(await pathExists(session.temp_file_path))) {
            await removeFileBestEffort(multerTempPath);
            await updateSessionFailure(uploadId, 'temp_file_missing', 'Upload temp file is missing. Restart required.', false);
            return res.status(410).json({
                success: false,
                error: 'Upload partial data unavailable. Please restart upload.',
                code: 'TEMP_FILE_MISSING',
                retryable: false,
            });
        }

        try {
            await withUploadBandwidthBudget(req.user.id, actualChunkSize);
            await fs.promises.mkdir(session.temp_file_path, { recursive: true });
            const targetChunkPath = path.join(session.temp_file_path, `chunk_${chunkIndex}.tmp`);
            if (multerTempPath) {
                try {
                    await fs.promises.rename(multerTempPath, targetChunkPath);
                } catch (renameErr: any) {
                    if (renameErr.code === 'EXDEV') {
                        await fs.promises.copyFile(multerTempPath, targetChunkPath);
                    } else {
                        throw renameErr;
                    }
                }
            } else if (chunkBuffer) {
                await fs.promises.writeFile(targetChunkPath, chunkBuffer);
            }

            await pool.query(
                `INSERT INTO upload_session_chunks (upload_id, chunk_index, chunk_size_bytes, chunk_hash_sha256)
                 VALUES ($1, $2, $3, $4)`,
                [uploadId, chunkIndex, actualChunkSize, serverChunkHash]
            );
        } catch (err: any) {
            if (err?.code === '23505') {
                const retryChunkRes = await pool.query(
                    `SELECT chunk_hash_sha256, chunk_size_bytes
                     FROM upload_session_chunks
                     WHERE upload_id = $1 AND chunk_index = $2
                     LIMIT 1`,
                    [uploadId, chunkIndex]
                );
                const retryChunk = retryChunkRes.rows[0];
                if (!retryChunk) {
                    return sendApiError(res, 409, 'CHUNK_RACE', 'Chunk race detected; please retry', { retryable: true });
                }
                const sameHash = String(retryChunk.chunk_hash_sha256 || '') === serverChunkHash;
                const sameSize = toInt(retryChunk.chunk_size_bytes) === actualChunkSize;
                if (!sameHash || !sameSize) {
                    return sendApiError(res, 409, 'CHUNK_CONFLICT', 'Conflicting chunk race');
                }
                // It's an exact duplicate, which is fine. Just return the same metrics and duplicate: true.
                const stats = await getChunkStats(uploadId);
                const nextExpectedChunk = computeNextExpectedChunk(totalChunks, stats.uploadedChunks);
                const capacity = await getCapacitySnapshot(req.user.id);
                return res.json({
                    success: true,
                    duplicate: true,
                    receivedBytes: stats.uploadedBytes,
                    totalBytes,
                    uploadedChunksCount: stats.uploadedCount,
                    totalChunks,
                    uploadedChunks: stats.uploadedChunks,
                    nextExpectedChunk,
                    ...buildBackpressureHints(session.status, capacity),
                });
            } else {
                logger.error('backend.upload', 'chunk_persist_failed', {
                    uploadId,
                    userId: req.user.id,
                    chunkIndex,
                    message: err?.message,
                });
                return sendApiError(res, 500, 'internal_error', 'Failed to persist chunk');
            }
        } finally {
            // Always clean up multer temp file
            await removeFileBestEffort(multerTempPath);
        }

        const stats = await saveChunkMetricsToSession(uploadId, 'uploading');
        const nextExpectedChunk = computeNextExpectedChunk(totalChunks, stats.uploadedChunks);
        const capacity = await getCapacitySnapshot(req.user.id);

        logger.info('backend.upload', 'chunk_uploaded', {
            uploadId,
            userId: req.user.id,
            chunkIndex,
            chunkBytes: actualChunkSize,
            uploadedChunksCount: stats.uploadedCount,
            totalChunks,
            receivedBytes: stats.uploadedBytes,
        });

        return res.json({
            success: true,
            duplicate: false,
            receivedBytes: stats.uploadedBytes,
            totalBytes,
            uploadedChunksCount: stats.uploadedCount,
            totalChunks,
            uploadedChunks: stats.uploadedChunks,
            nextExpectedChunk,
            ...buildBackpressureHints('uploading', capacity),
        });
    } finally {
        chunkIndexLocks.delete(chunkKey);
        const remaining = Math.max(0, (activeChunksByUploadId.get(uploadId) || 1) - 1);
        if (remaining === 0) activeChunksByUploadId.delete(uploadId);
        else activeChunksByUploadId.set(uploadId, remaining);
    }
};

// ─── Step 3: Complete Upload ────────────────────────────────────────────────

export const completeUpload = async (req: AuthRequest, res: Response) => {
    if (!req.user) return sendApiError(res, 401, 'unauthorized', 'Unauthorized');
    const correlationId = String(req.headers['x-correlation-id'] || crypto.randomUUID());
    const idempotencyKey = String(req.headers['idempotency-key'] || '').trim() || undefined;

    const uploadId = String(req.body.uploadId || '').trim();
    if (!uploadId) return sendApiError(res, 400, 'missing_upload_id', 'Missing uploadId');

    logUploadStage('complete_requested', {
        uploadId,
        userId: req.user.id,
        correlationId,
        idempotencyKey: idempotencyKey || null,
    });

    await promoteQueuedSessionsIfCapacity();

    let session = await getOwnedUploadSession(uploadId, req.user.id);
    if (!session) return sendApiError(res, 404, 'upload_not_found', 'Upload session not found');

    if (session.status === 'queued') {
        await promoteQueuedSessionsIfCapacity();
        const refreshedSession = await getOwnedUploadSession(uploadId, req.user.id);
        if (refreshedSession) session = refreshedSession;
    }

    if (session.status === 'completed') {
        return res.json({ success: true, message: 'Already completed', correlation_id: correlationId, idempotency_key: idempotencyKey });
    }
    if (session.status === 'queued') {
        const capacity = await getCapacitySnapshot(req.user.id);
        const queuePosition = await getQueuePosition(uploadId, req.user.id);
        return res.status(409).json({
            success: false,
            status: 'queued',
            code: 'UPLOAD_QUEUED',
            error: 'Upload is still queued and cannot be completed yet.',
            retryable: true,
            queuePositionGlobal: queuePosition.queuePositionGlobal,
            queuePositionUser: queuePosition.queuePositionUser,
            ...buildBackpressureHints('queued', capacity),
        });
    }
    if (session.status === 'paused') {
        return sendApiError(res, 409, 'UPLOAD_PAUSED', 'Upload is paused. Resume before completing.', { retryable: true });
    }
    if (session.status === 'processing') {
        const capacity = await getCapacitySnapshot(req.user.id);
        return res.json({
            success: true,
            status: 'processing',
            message: 'Upload is already processing on Telegram',
            correlation_id: correlationId,
            idempotency_key: idempotencyKey,
            ...buildBackpressureHints('processing', capacity),
        });
    }
    if (session.status === 'cancelled') {
        return sendApiError(res, 409, 'UPLOAD_CANCELLED', 'Upload is cancelled');
    }
    if (session.status === 'failed') {
        return res.status(409).json({
            success: false,
            error: 'Upload previously failed. Please restart the upload.',
            code: 'UPLOAD_FAILED',
            retryable: false,
            errorCode: session.error_code,
            errorMessage: session.error_message,
        });
    }

    const totalChunks = toInt(session.total_chunks);
    const chunkSize = Math.max(1, toInt(session.chunk_size_bytes) || FIXED_CHUNK_SIZE_BYTES);
    const totalBytes = Math.max(0, toInt(session.total_bytes));
    const manifestIntegrity = await validateChunkManifestIntegrity(uploadId, totalChunks, chunkSize, totalBytes);
    if (!manifestIntegrity.valid) {
        return res.status(409).json({
            success: false,
            error: 'Upload manifest integrity check failed. Missing or corrupted chunks detected.',
            code: 'UPLOAD_MANIFEST_INVALID',
            retryable: true,
            ...manifestIntegrity,
        });
    }

    const chunkStats = await getChunkStats(uploadId);
    if (chunkStats.uploadedCount < totalChunks) {
        const nextExpectedChunk = computeNextExpectedChunk(totalChunks, chunkStats.uploadedChunks);
        return res.status(409).json({
            success: false,
            error: `Upload incomplete: ${chunkStats.uploadedCount}/${totalChunks} chunks received`,
            code: 'UPLOAD_INCOMPLETE',
            nextExpectedChunk,
            uploadedChunksCount: chunkStats.uploadedCount,
            totalChunks,
        });
    }

    await pool.query(
        `UPDATE upload_sessions
         SET status = 'processing',
             telegram_progress_percent = GREATEST(telegram_progress_percent, 0),
             error_code = NULL,
             error_message = NULL,
             retryable = false,
             uploaded_chunks = $2::jsonb,
             received_bytes = $3,
             updated_at = NOW()
         WHERE upload_id = $1`,
        [uploadId, JSON.stringify(chunkStats.uploadedChunks), chunkStats.uploadedBytes]
    );

    startUploadFinalizer(uploadId, req.user.sessionString);

    const capacity = await getCapacitySnapshot(req.user.id);

    return res.json({
        success: true,
        status: 'processing',
        message: 'Upload finalizing to Telegram in background',
        correlation_id: correlationId,
        idempotency_key: idempotencyKey,
        ...buildBackpressureHints('processing', capacity),
    });
};

// ─── Resume Session ─────────────────────────────────────────────────────────

export const resumeUploadSession = async (req: AuthRequest, res: Response) => {
    if (!req.user) return sendApiError(res, 401, 'unauthorized', 'Unauthorized');

    const resumeToken = getResumeTokenFromRequest(req);
    if (!resumeToken) {
        return sendApiError(res, 400, 'resume_token_required', 'Missing resume token.', { retryable: false });
    }

    const parsed = verifyUploadResumeToken(resumeToken);
    if (!parsed) {
        return sendApiError(res, 401, 'resume_token_invalid', 'Resume token is invalid or expired.', { retryable: false });
    }

    if (parsed.userId !== req.user.id) {
        return sendApiError(res, 403, 'resume_token_forbidden', 'Resume token is not valid for this user.', { retryable: false });
    }

    const hintedUploadId = String(req.body?.uploadId || '').trim();
    if (hintedUploadId && hintedUploadId !== parsed.uploadId) {
        return sendApiError(res, 409, 'resume_upload_mismatch', 'resume token does not match requested uploadId', { retryable: false });
    }

    await promoteQueuedSessionsIfCapacity();

    const session = await getOwnedUploadSession(parsed.uploadId, req.user.id);
    if (!session) {
        return sendApiError(res, 404, 'upload_not_found', 'Upload not found or expired');
    }

    const payload = await toUploadStatusPayload(session);
    return res.json({ ...payload, resumed: true });
};

// ─── Pause & Resume ─────────────────────────────────────────────────────────

export const pauseUpload = async (req: AuthRequest, res: Response) => {
    if (!req.user) return sendApiError(res, 401, 'unauthorized', 'Unauthorized');

    const uploadId = String(req.body.uploadId || '').trim();
    if (!uploadId) return sendApiError(res, 400, 'missing_upload_id', 'Missing uploadId');

    const session = await getOwnedUploadSession(uploadId, req.user.id);
    if (!session) return sendApiError(res, 404, 'upload_not_found', 'Upload session not found');

    if (session.status === 'completed' || session.status === 'cancelled') {
        return sendApiError(res, 409, 'UPLOAD_TERMINAL', 'Upload is already in a terminal state.', { retryable: false });
    }

    if (session.status === 'processing') {
        return sendApiError(res, 409, 'UPLOAD_PROCESSING', 'Upload is already finalizing on Telegram and cannot be paused now.', { retryable: false });
    }

    await pool.query(
        `UPDATE upload_sessions
         SET status = 'paused',
             error_code = 'UPLOAD_PAUSED',
             error_message = 'Upload paused by user',
             retryable = true,
             updated_at = NOW()
         WHERE upload_id = $1`,
        [uploadId]
    );
    clearFinalizerRetryState(uploadId);

    logUploadStage('upload_paused', {
        uploadId,
        userId: req.user.id,
        previousStatus: session.status,
    });

    const refreshed = await getOwnedUploadSession(uploadId, req.user.id);
    const payload = refreshed ? await toUploadStatusPayload(refreshed) : { success: true, status: 'paused', uploadId };
    return res.json({ ...payload, paused: true });
};

export const resumePausedUpload = async (req: AuthRequest, res: Response) => {
    if (!req.user) return sendApiError(res, 401, 'unauthorized', 'Unauthorized');

    const uploadId = String(req.body.uploadId || '').trim();
    if (!uploadId) return sendApiError(res, 400, 'missing_upload_id', 'Missing uploadId');

    const session = await getOwnedUploadSession(uploadId, req.user.id);
    if (!session) return sendApiError(res, 404, 'upload_not_found', 'Upload session not found');

    if (session.status !== 'paused') {
        const payload = await toUploadStatusPayload(session);
        return res.json({ ...payload, resumed: false });
    }

    await pool.query(
        `UPDATE upload_sessions
         SET status = 'queued',
             error_code = NULL,
             error_message = NULL,
             retryable = true,
             updated_at = NOW()
         WHERE upload_id = $1`,
        [uploadId]
    );
    await promoteQueuedSessionsIfCapacity();

    logUploadStage('upload_resumed', {
        uploadId,
        userId: req.user.id,
    });

    const refreshed = await getOwnedUploadSession(uploadId, req.user.id);
    const payload = refreshed ? await toUploadStatusPayload(refreshed) : { success: true, status: 'queued', uploadId };
    return res.json({ ...payload, resumed: true });
};

// ─── Step 4: Cancel Upload ──────────────────────────────────────────────────

export const cancelUpload = async (req: AuthRequest, res: Response) => {
    if (!req.user) return sendApiError(res, 401, 'unauthorized', 'Unauthorized');

    const uploadId = String(req.body.uploadId || '').trim();
    if (!uploadId) return sendApiError(res, 400, 'missing_upload_id', 'Missing uploadId');

    const session = await getOwnedUploadSession(uploadId, req.user.id);
    if (!session) {
        return res.json({ success: true, message: 'Upload session not found or already cleaned up' });
    }

    await pool.query(
        `UPDATE upload_sessions
         SET status = 'cancelled',
             retryable = false,
             updated_at = NOW(),
             completed_at = NOW()
         WHERE upload_id = $1`,
        [uploadId]
    );

    await promoteQueuedSessionsIfCapacity();
    clearFinalizerRetryState(uploadId);

    if (!activeFinalizers.has(uploadId)) {
        cleanupSessionTempFile(session.temp_file_path);
    }

    logger.info('backend.upload', 'upload_cancelled', {
        uploadId,
        userId: req.user.id,
        fileName: session.file_name,
    });

    logUploadStage('upload_cancelled_stage', {
        uploadId,
        userId: req.user.id,
        finalizerActive: activeFinalizers.has(uploadId),
    });

    return res.json({ success: true, message: 'Upload cancelled' });
};

// ─── Step 5: Poll Status ────────────────────────────────────────────────────

export const checkUploadStatus = async (req: AuthRequest, res: Response) => {
    if (!req.user) return sendApiError(res, 401, 'unauthorized', 'Unauthorized');

    const uploadId = String(req.params.uploadId || '').trim();
    if (!uploadId) return sendApiError(res, 400, 'missing_upload_id', 'Missing uploadId');

    await promoteQueuedSessionsIfCapacity();

    const session = await getOwnedUploadSession(uploadId, req.user.id);
    if (!session) {
        return sendApiError(res, 404, 'upload_not_found', 'Upload not found or expired');
    }

    const payload = await toUploadStatusPayload(session);
    return res.json(payload);
};

// ─── Queue Health ───────────────────────────────────────────────────────────

export const getUploadQueueHealth = async (_req: AuthRequest, res: Response) => {
    const queueRes = await pool.query(
        `SELECT
            COUNT(*) FILTER (WHERE status = 'queued')::int AS queued,
            COUNT(*) FILTER (WHERE status = 'uploading')::int AS uploading,
            COUNT(*) FILTER (WHERE status = 'processing')::int AS processing,
            COUNT(*) FILTER (WHERE status = 'paused')::int AS paused,
            COUNT(*) FILTER (WHERE status = 'failed' AND retryable = true)::int AS retryable_failed
         FROM upload_sessions`
    );
    const row = queueRes.rows[0] || {};
    const queueHealth = getUploadFinalizerQueueHealth();
    const mem = process.memoryUsage();

    return res.json({
        success: true,
        queue: {
            queued: Number(row.queued || 0),
            uploading: Number(row.uploading || 0),
            processing: Number(row.processing || 0),
            paused: Number(row.paused || 0),
            retryableFailed: Number(row.retryable_failed || 0),
            activeFinalizers: activeFinalizers.size,
            scheduledRetries: pendingFinalizerRetries.size,
            finalizerAttemptsTracked: finalizerAttemptByUploadId.size,
            activeChunkUploadMaps: activeChunksByUploadId.size,
            finalizerQueue: queueHealth,
        },
        processMemory: {
            rssBytes: mem.rss,
            heapTotalBytes: mem.heapTotal,
            heapUsedBytes: mem.heapUsed,
            externalBytes: mem.external,
            arrayBuffersBytes: mem.arrayBuffers,
        },
    });
};
