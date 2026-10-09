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
import { sanitizeUploadFileName } from './upload.helpers';
import { ensureTempUploadFile, cleanupSessionTempFile } from './upload.temp';
import { startUploadFinalizer } from './upload.finalizer';
import { checkUploadStatus, cancelUpload } from './upload.handlers';
import { FIXED_CHUNK_SIZE_BYTES, MAX_FILE_SIZE_BYTES } from './upload.types';

/** Multipart compatibility endpoint backed by the canonical manifest and finalizer. */
export const uploadFile = async (req: AuthRequest, res: Response) => {
    let uploadDir = '';
    let committed = false;
    try {
        if (!req.user) return sendApiError(res, 401, 'unauthorized', 'Unauthorized');
        const file = req.file;
        if (!file || file.size <= 0) return sendApiError(res, 400, 'invalid_file', 'Choose a non-empty file');
        if (file.size > MAX_FILE_SIZE_BYTES) return sendApiError(res, 413, 'file_too_large', 'File exceeds the configured upload limit');
        if (!isAllowedUploadMime(file.mimetype)) return sendApiError(res, 400, 'unsupported_type', 'This file type is not supported');
        const folderId = req.body.folderId || null;
        if (folderId) {
            const folder = await pool.query('SELECT id FROM folders WHERE id = $1 AND user_id = $2 AND is_trashed = false', [folderId, req.user.id]);
            if (!folder.rows.length) return sendApiError(res, 404, 'not_found', 'Folder not found');
        }
        const target = await resolveTelegramUploadTransport(req.user.sessionString, req.body.telegramChatId);
        const uploadId = crypto.randomUUID();
        const fileName = sanitizeUploadFileName(file.originalname);
        uploadDir = ensureTempUploadFile(uploadId, fileName, file.size);
        const totalChunks = Math.ceil(file.size / FIXED_CHUNK_SIZE_BYTES);
        const manifest: Array<{ index: number; size: number; hash: string }> = [];
        const source = await fs.promises.open(file.path, 'r');
        try {
            for (let index = 0; index < totalChunks; index++) {
                if (req.aborted) throw new Error('Upload request interrupted');
                const size = Math.min(FIXED_CHUNK_SIZE_BYTES, file.size - index * FIXED_CHUNK_SIZE_BYTES);
                const buffer = Buffer.allocUnsafe(size);
                let read = 0;
                while (read < size) {
                    const result = await source.read(buffer, read, size - read, index * FIXED_CHUNK_SIZE_BYTES + read);
                    if (!result.bytesRead) throw new Error('Incomplete uploaded file');
                    read += result.bytesRead;
                }
                await fs.promises.writeFile(path.join(uploadDir, `chunk_${index}.tmp`), buffer, { flag: 'wx' });
                manifest.push({ index, size, hash: crypto.createHash('sha256').update(buffer).digest('hex') });
            }
        } finally { await source.close(); }
        const db = await pool.connect();
        try {
            await db.query('BEGIN');
            await db.query(
                `INSERT INTO upload_sessions (upload_id, user_id, file_name, mime_type, folder_id, telegram_chat_id,
                    total_bytes, chunk_size_bytes, total_chunks, received_bytes, uploaded_chunks, status, temp_file_path)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$7,$10::jsonb,'processing',$11)`,
                [uploadId, req.user.id, fileName, file.mimetype, folderId, target.chatId, file.size,
                    FIXED_CHUNK_SIZE_BYTES, totalChunks, JSON.stringify(manifest.map(chunk => chunk.index)), uploadDir]
            );
            for (const chunk of manifest) {
                await db.query(`INSERT INTO upload_session_chunks (upload_id, chunk_index, chunk_size_bytes, chunk_hash_sha256)
                    VALUES ($1,$2,$3,$4)`, [uploadId, chunk.index, chunk.size, chunk.hash]);
            }
            await db.query('COMMIT');
            committed = true;
        } catch (error) {
            await db.query('ROLLBACK');
            throw error;
        } finally { db.release(); }
        startUploadFinalizer(uploadId, req.user.sessionString);
        return res.status(202).json({ success: true, uploadId, fileName, fileSize: file.size, status: 'processing',
            message: 'File received. Saving to Telegram.' });
    } catch (error: any) {
        logger.error('backend.upload', 'multipart_upload_failed', { message: error?.message });
        return sendApiError(res, 500, 'upload_failed', 'Could not prepare the upload. Please retry.');
    } finally {
        if (req.file?.path) await fs.promises.rm(req.file.path, { force: true }).catch(() => undefined);
        if (!committed && uploadDir) cleanupSessionTempFile(uploadDir);
    }
};

export const getUploadFileStatus = checkUploadStatus;
export const cancelUploadFile = (req: AuthRequest, res: Response) => {
    req.body = { ...req.body, uploadId: req.params.uploadId };
    return cancelUpload(req, res);
};
