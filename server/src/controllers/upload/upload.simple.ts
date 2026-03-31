import { Response } from 'express';
import { AuthRequest } from '../../middlewares/auth.middleware';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import os from 'os';
import pool from '../../config/db';
import { logger } from '../../utils/logger';
import { sendApiError } from '../../utils/apiError';
import { isAllowedUploadMime } from '../../utils/uploadMime';
import { resolveTelegramUploadTransport } from '../../services/storage/telegram-storage.adapter';
import { withUploadBandwidthBudget } from '../../services/upload-job-queue.service';
import { sanitizeUploadFileName } from './upload.helpers';

const MAX_FILE_SIZE = 5 * 1024 * 1024 * 1024; // 5GB
const UPLOAD_TEMP_DIR = path.join(os.tmpdir(), 'teledrive_uploads');

// Ensure temp directory exists
try {
    fs.mkdirSync(UPLOAD_TEMP_DIR, { recursive: true });
} catch (err) {
    logger.warn('Failed to create upload temp dir:', err);
}

/**
 * Simple single-file upload handler
 * POST /upload/file
 * Form data: { file: File, folderId?: number, telegramChatId?: string }
 */
export const uploadFile = async (req: AuthRequest, res: Response) => {
    try {
        if (!req.user) {
            return sendApiError(res, 401, 'unauthorized', 'Unauthorized');
        }

        if (!req.file) {
            return sendApiError(res, 400, 'no_file', 'No file provided');
        }

        const { file } = req;
        const { folderId, telegramChatId } = req.body;

        // Validate file
        if (!file.originalname || !file.size) {
            return sendApiError(res, 400, 'invalid_file', 'Invalid file');
        }

        if (file.size > MAX_FILE_SIZE) {
            return sendApiError(res, 413, 'file_too_large', 'File exceeds maximum size of 5GB');
        }

        if (!isAllowedUploadMime(file.mimetype)) {
            return sendApiError(res, 400, 'unsupported_type', `File type ${file.mimetype} not allowed`);
        }

        // Generate upload ID
        const uploadId = crypto.randomBytes(16).toString('hex');
        const fileName = sanitizeUploadFileName(file.originalname);
        const tempPath = path.join(UPLOAD_TEMP_DIR, uploadId);

        // Move file to temp location
        await fs.promises.rename(file.path, tempPath);

        // Apply bandwidth budget
        await withUploadBandwidthBudget(String(req.user.id), file.size);

        // Store in database
        const result = await pool.query(
            `INSERT INTO upload_sessions (
                id, user_id, file_name, file_size, file_mime, status, 
                folder_id, telegram_chat_id, temp_file_path, created_at, updated_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW())
            RETURNING *`,
            [
                uploadId,
                req.user.id,
                fileName,
                file.size,
                file.mimetype,
                'processing', // New status for simple uploads
                folderId || null,
                telegramChatId || null,
                tempPath,
            ]
        );

        // Enqueue for processing/finalization
        // This would be handled by a background job that moves files to permanent storage
        logger.info(`[UPLOAD] Simple upload initiated: ${uploadId} by user ${req.user.id}`);

        res.json({
            success: true,
            uploadId,
            fileName,
            fileSize: file.size,
            status: 'processing',
            message: 'File uploaded successfully and queued for processing',
        });
    } catch (err: any) {
        logger.error('[UPLOAD] Simple upload error:', err);
        sendApiError(res, 500, 'upload_failed', 'Upload failed', { error: err.message });
    }
};

/**
 * Get upload status
 * GET /upload/simple/status/:uploadId
 */
export const getUploadFileStatus = async (req: AuthRequest, res: Response) => {
    try {
        if (!req.user) {
            return sendApiError(res, 401, 'unauthorized', 'Unauthorized');
        }

        const { uploadId } = req.params;

        const result = await pool.query(
            'SELECT * FROM upload_sessions WHERE id = $1 AND user_id = $2',
            [uploadId, req.user.id]
        );

        if (result.rows.length === 0) {
            return sendApiError(res, 404, 'not_found', 'Upload not found');
        }

        const session = result.rows[0];

        res.json({
            uploadId: session.id,
            fileName: session.file_name,
            fileSize: session.file_size,
            status: session.status,
            createdAt: session.created_at,
            updatedAt: session.updated_at,
            error: session.error_message || null,
        });
    } catch (err: any) {
        logger.error('[UPLOAD] Get status error:', err);
        sendApiError(res, 500, 'status_error', 'Failed to get upload status');
    }
};

/**
 * Cancel upload
 * POST /upload/simple/cancel/:uploadId
 */
export const cancelUploadFile = async (req: AuthRequest, res: Response) => {
    try {
        if (!req.user) {
            return sendApiError(res, 401, 'unauthorized', 'Unauthorized');
        }

        const { uploadId } = req.params;

        const result = await pool.query(
            'SELECT * FROM upload_sessions WHERE id = $1 AND user_id = $2',
            [uploadId, req.user.id]
        );

        if (result.rows.length === 0) {
            return sendApiError(res, 404, 'not_found', 'Upload not found');
        }

        const session = result.rows[0];

        // Clean up temp file
        if (session.temp_file_path) {
            try {
                await fs.promises.unlink(session.temp_file_path);
            } catch {
                // ignore
            }
        }

        // Update status
        await pool.query(
            'UPDATE upload_sessions SET status = $1, updated_at = NOW() WHERE id = $2',
            ['cancelled', uploadId]
        );

        logger.info(`[UPLOAD] Cancelled upload: ${uploadId}`);

        res.json({
            success: true,
            message: 'Upload cancelled',
        });
    } catch (err: any) {
        logger.error('[UPLOAD] Cancel error:', err);
        sendApiError(res, 500, 'cancel_failed', 'Failed to cancel upload');
    }
};
