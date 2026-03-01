import { Response } from 'express';
import { AuthRequest } from '../middlewares/auth.middleware';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import pool from '../config/db';
import { getDynamicClient } from '../services/telegram.service';
import { CustomFile } from 'telegram/client/uploads';
import { Api } from 'telegram';

// Retry helper for Telegram uploads
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const uploadWithRetry = async (client: any, chatId: string, params: any, retries = 3) => {
    for (let i = 0; i < retries; i++) {
        try {
            return await client.sendFile(chatId, params);
        } catch (error: any) {
            console.error(`Telegram upload error (Attempt ${i + 1}/${retries}):`, error);
            if (error?.message?.includes('FLOOD')) {
                const waitSeconds = parseInt(error.message.match(/\d+/)?.[0] || '10', 10);
                console.log(`Flood wait triggered. Waiting ${waitSeconds} seconds...`);
                await sleep((waitSeconds + 2) * 1000);
            } else if (i === retries - 1) {
                throw error;
            } else {
                await sleep(2000 * Math.pow(2, i)); // exponential backoff
            }
        }
    }
};

// Upload state management
export const uploadState = new Map<string, any>();

// Helper for formatting file row
const formatFileRow = (row: any) => ({
    id: row.id,
    name: row.file_name,
    folder_id: row.folder_id,
    size: row.file_size,
    mime_type: row.mime_type,
    telegram_chat_id: row.telegram_chat_id,
    is_starred: row.is_starred,
    is_trashed: row.is_trashed,
    created_at: row.created_at,
    updated_at: row.updated_at,
});

export const initUpload = async (req: AuthRequest, res: Response) => {
    if (!req.user) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const { originalname, size, mimetype, folder_id, telegram_chat_id } = req.body;
    if (!originalname || !size) return res.status(400).json({ success: false, error: 'Missing file info' });

    const uploadId = crypto.randomUUID();
    const tempFilePath = path.join(__dirname, '../../uploads', `${uploadId}.tmp`);

    uploadState.set(uploadId, {
        progress: 0,
        status: 'uploading_to_server',
        filePath: tempFilePath,
        receivedBytes: 0,
        totalBytes: Number(size),
        originalname,
        mimetype: mimetype || 'application/octet-stream',
        folder_id: folder_id || null,
        telegram_chat_id: telegram_chat_id || 'me',
        userId: req.user.id,
        sessionString: req.user.sessionString
    });

    res.json({ success: true, uploadId });
};

export const uploadChunk = async (req: AuthRequest, res: Response) => {
    if (!req.user) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const { uploadId } = req.body;
    if (!uploadId) return res.status(400).json({ success: false, error: 'Missing uploadId' });

    const state = uploadState.get(uploadId);
    if (!state) return res.status(404).json({ success: false, error: 'Upload session not found' });
    if (state.userId !== req.user.id) return res.status(403).json({ success: false, error: 'Forbidden' });

    if (!req.file && !req.body.chunkBase64) return res.status(400).json({ success: false, error: 'No chunk data provided' });

    try {
        let chunkData: Buffer;
        if (req.file) {
            chunkData = fs.readFileSync(req.file.path);
            if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        } else {
            chunkData = Buffer.from(req.body.chunkBase64, 'base64');
        }

        fs.appendFileSync(state.filePath, chunkData);
        state.receivedBytes += chunkData.length;

        res.json({ success: true, receivedBytes: state.receivedBytes, totalBytes: state.totalBytes });
    } catch (err: any) {
        if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        res.status(500).json({ success: false, error: err.message });
    }
};

export const completeUpload = async (req: AuthRequest, res: Response) => {
    if (!req.user) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const { uploadId } = req.body;
    if (!uploadId) return res.status(400).json({ success: false, error: 'Missing uploadId' });

    const state = uploadState.get(uploadId);
    if (!state) return res.status(404).json({ success: false, error: 'Upload session not found' });
    if (state.userId !== req.user.id) return res.status(403).json({ success: false, error: 'Forbidden' });

    // Mark as transitioning to Telegram
    state.status = 'uploading_to_telegram';
    res.json({ success: true, message: 'Upload finalizing to Telegram in background' });

    // Begin async Telegram upload with chunking & retry logic
    (async () => {
        try {
            const client = await getDynamicClient(state.sessionString);

            // Generate hash for duplicate check (optional, but good for stability)
            const fileBuffer = fs.readFileSync(state.filePath);
            const hash = crypto.createHash('sha256').update(fileBuffer).digest('hex');

            // Handle progress callback
            const progressCallback = (progress: number) => {
                // gramjs progress is float from 0 to 1
                state.progress = Math.round(progress * 100);
            };

            const customFile = new CustomFile(state.originalname, state.totalBytes, state.filePath);

            // Upload to telegram with progress & automatic retry logic
            const uploadedMessage = await uploadWithRetry(client, state.telegram_chat_id, {
                file: customFile,
                caption: `[TeleDrive] ${state.originalname}`,
                workers: 3, // parallel upload workers for MTProto
                progressCallback,
            });

            if (!uploadedMessage) throw new Error("Upload failed after retries.");
            const messageId = uploadedMessage.id;
            const fileId = uploadedMessage.document
                ? uploadedMessage.document.id.toString()
                : uploadedMessage.photo
                    ? uploadedMessage.photo.id.toString()
                    : '';

            const result = await pool.query(
                `INSERT INTO files (user_id, folder_id, file_name, file_size, telegram_file_id, telegram_message_id, telegram_chat_id, mime_type, sha256_hash)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
                [state.userId, state.folder_id, state.originalname, state.totalBytes, fileId, messageId, state.telegram_chat_id, state.mimetype, hash]
            );

            // Cleanup & update state
            if (fs.existsSync(state.filePath)) fs.unlinkSync(state.filePath);

            state.status = 'completed';
            state.progress = 100;
            state.fileResult = formatFileRow(result.rows[0]);

            // Clean memory after some time
            setTimeout(() => { uploadState.delete(uploadId); }, 60 * 60 * 1000);

        } catch (err: any) {
            console.error("Telegram Upload Error:", err);
            if (fs.existsSync(state.filePath)) fs.unlinkSync(state.filePath);
            state.status = 'error';
            state.error = err.message;
        }
    })();
};

export const checkUploadStatus = async (req: AuthRequest, res: Response) => {
    if (!req.user) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const { uploadId } = req.params;
    const state = uploadState.get(uploadId as string);

    if (!state) return res.status(404).json({ success: false, error: 'Upload not found or expired' });
    if (state.userId !== req.user.id) return res.status(403).json({ success: false, error: 'Forbidden' });

    res.json({
        success: true,
        progress: state.progress,
        status: state.status,
        file: state.fileResult,
        error: state.error,
        receivedBytes: state.receivedBytes,
        totalBytes: state.totalBytes
    });
};
