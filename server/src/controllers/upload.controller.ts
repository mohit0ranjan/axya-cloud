import { Response } from 'express';
import { AuthRequest } from '../middlewares/auth.middleware';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import pool from '../config/db';
import { getDynamicClient } from '../services/telegram.service';
import { CustomFile } from 'telegram/client/uploads';
import { logger } from '../utils/logger';

// ─── Helpers ────────────────────────────────────────────────────────────────
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

const randomDelay = (min = 300, max = 800) =>
    sleep(Math.floor(Math.random() * (max - min + 1)) + min);

const computeFileHashes = async (filePath: string): Promise<{ sha256: string; md5: string }> => {
    return new Promise((resolve, reject) => {
        const sha256 = crypto.createHash('sha256');
        const md5 = crypto.createHash('md5');
        const stream = fs.createReadStream(filePath);

        stream.on('data', (chunk) => {
            sha256.update(chunk);
            md5.update(chunk);
        });
        stream.on('end', () => {
            resolve({
                sha256: sha256.digest('hex'),
                md5: md5.digest('hex'),
            });
        });
        stream.on('error', reject);
    });
};

// Max retries for Telegram upload, with exponential backoff + FLOOD_WAIT handling
const uploadToTelegramWithRetry = async (
    client: any,
    chatId: string,
    params: any,
    maxRetries = 4
): Promise<any> => {
    for (let i = 0; i < maxRetries; i++) {
        try {
            await randomDelay(); // Anti-429 delay before each attempt
            return await client.sendFile(chatId, params);
        } catch (error: any) {
            const raw = error?.message || '';
            console.error(`[Telegram] Upload attempt ${i + 1}/${maxRetries} failed:`, raw);

            // Handle FLOOD_WAIT — Telegram explicitly gives wait time
            if (raw.includes('FLOOD_WAIT') || raw.includes('FLOOD')) {
                const waitSec = parseInt(raw.match(/\d+/)?.[0] || '15', 10);
                console.warn(`[Telegram] FLOOD_WAIT: Waiting ${waitSec}s...`);
                await sleep((waitSec + 3) * 1000); // Extra 3s buffer
                continue;
            }

            // Other errors: backoff
            if (i < maxRetries - 1) {
                const backoff = [2000, 5000, 10000, 20000][i] || 20000;
                console.warn(`[Telegram] Retrying in ${backoff / 1000}s...`);
                await sleep(backoff);
            } else {
                throw error;
            }
        }
    }
};

// ─── Upload Semaphore: limit concurrent Telegram uploads ────────────────────
// Prevents server OOM crash when 100 photos complete simultaneously.
// Only 3 files upload to Telegram at any one time; the rest queue.
class Semaphore {
    private running = 0;
    private queue: Array<() => void> = [];
    constructor(private max: number) { }
    async acquire(): Promise<() => void> {
        if (this.running < this.max) {
            this.running++;
            return () => this.release();
        }
        return new Promise<() => void>(resolve => {
            this.queue.push(() => {
                this.running++;
                resolve(() => this.release());
            });
        });
    }
    private release() {
        this.running--;
        if (this.queue.length > 0) {
            const next = this.queue.shift()!;
            next();
        }
    }
}
const telegramSemaphore = new Semaphore(3); // max 3 concurrent Telegram operations

// ─── Upload State (in-memory, auto-cleans after 1h) ─────────────────────────
export const uploadState = new Map<string, any>();

// Auto-evict completed/failed sessions older than 1h (prevent memory leak)
const MAX_UPLOAD_SESSIONS = 200;
const evictOldSessions = () => {
    if (uploadState.size <= MAX_UPLOAD_SESSIONS) return;
    const now = Date.now();
    for (const [id, state] of uploadState.entries()) {
        if (['completed', 'failed'].includes(state.status) && now - state.startedAt > 30 * 60 * 1000) {
            // Delete old temp file if it still exists
            if (state.filePath && fs.existsSync(state.filePath)) {
                try { fs.unlinkSync(state.filePath); } catch { }
            }
            uploadState.delete(id);
        }
        if (uploadState.size <= MAX_UPLOAD_SESSIONS / 2) break;
    }
};

// Helper for formatting file row consistently
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

// ─── Step 1: Init Upload ────────────────────────────────────────────────────
// Checks hash first → if duplicate, returns existing file immediately.
export const initUpload = async (req: AuthRequest, res: Response) => {
    if (!req.user) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const { originalname, size, mimetype, folder_id, telegram_chat_id, hash } = req.body;

    if (!originalname || !size) {
        return res.status(400).json({ success: false, error: 'Missing file info (originalname, size required)' });
    }

    // ── Deduplication: check hash in DB ────────────────────────────────────
    if (hash) {
        try {
            const existing = await pool.query(
                `SELECT * FROM files WHERE (sha256_hash = $1 OR md5_hash = $1) AND user_id = $2 LIMIT 1`,
                [hash, req.user.id]
            );

            if (existing.rows.length > 0) {
                const existingFile = existing.rows[0];

                // If a target folder is different from existing, create a reference row
                const effectiveFolderId = folder_id || null;
                if (effectiveFolderId && effectiveFolderId !== existingFile.folder_id) {
                    // Insert a new DB row that reuses the same telegram_file_id
                    const newFileRes = await pool.query(
                        `INSERT INTO files (user_id, folder_id, file_name, file_size, telegram_file_id, telegram_message_id, telegram_chat_id, mime_type, sha256_hash, md5_hash)
                         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
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
                        ]
                    );
                    console.log(`[Upload] Duplicate detected → inserted reference in folder ${effectiveFolderId}`);
                    return res.json({
                        success: true,
                        duplicate: true,
                        file: formatFileRow(newFileRes.rows[0]),
                        message: 'File already exists — reused from library',
                    });
                }

                console.log(`[Upload] Duplicate detected → returning existing file id=${existingFile.id}`);
                return res.json({
                    success: true,
                    duplicate: true,
                    file: formatFileRow(existingFile),
                    message: 'File already exists — skipped upload',
                });
            }
        } catch (hashCheckErr: any) {
            console.warn('[Upload] Hash check failed (non-fatal):', hashCheckErr.message);
            // Continue with normal upload if hash check fails
        }
    }

    // ── No duplicate, proceed with upload ──────────────────────────────────
    const uploadId = crypto.randomUUID();
    const filePath = path.join(__dirname, '../../uploads', `${uploadId}.tmp`);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });

    // Mark upload session
    uploadState.set(uploadId, {
        userId: req.user.id,
        sessionString: req.user.sessionString,  // ✅ was session_string (wrong field name)
        filePath,
        fileName: originalname,
        fileSize: parseInt(size, 10),
        mimeType: mimetype || 'application/octet-stream',
        folderId: folder_id || null,
        chatId: telegram_chat_id || 'me',
        totalBytes: parseInt(size, 10),
        receivedBytes: 0,
        status: 'initialized',
        progress: 0,
        startedAt: Date.now(), // ✅ track for eviction
    });

    // Evict old sessions to prevent memory leak
    evictOldSessions();

    return res.json({ success: true, uploadId, duplicate: false });
};

// ─── Step 2: Upload Chunk ───────────────────────────────────────────────────
export const uploadChunk = async (req: AuthRequest, res: Response) => {
    if (!req.user) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const { uploadId, chunkIndex, chunkBase64 } = req.body;
    if (!uploadId) return res.status(400).json({ success: false, error: 'Missing uploadId' });

    const state = uploadState.get(uploadId);
    if (!state) return res.status(404).json({ success: false, error: 'Upload session not found' });
    if (state.userId !== req.user.id) return res.status(403).json({ success: false, error: 'Forbidden' });

    if (!req.file && !chunkBase64) {
        return res.status(400).json({ success: false, error: 'No chunk data provided' });
    }

    try {
        let chunkData: Buffer;
        if (req.file) {
            chunkData = fs.readFileSync(req.file.path);
            if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        } else {
            chunkData = Buffer.from(chunkBase64, 'base64');
        }

        fs.appendFileSync(state.filePath, chunkData);
        state.receivedBytes += chunkData.length;

        return res.json({
            success: true,
            receivedBytes: state.receivedBytes,
            totalBytes: state.totalBytes,
        });
    } catch (err: any) {
        if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        return res.status(500).json({ success: false, error: err.message });
    }
};

// ─── Step 3: Complete Upload ────────────────────────────────────────────────
export const completeUpload = async (req: AuthRequest, res: Response) => {
    if (!req.user) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const { uploadId } = req.body;
    if (!uploadId) return res.status(400).json({ success: false, error: 'Missing uploadId' });

    const state = uploadState.get(uploadId);
    if (!state) return res.status(404).json({ success: false, error: 'Upload session not found' });
    if (state.userId !== req.user.id) return res.status(403).json({ success: false, error: 'Forbidden' });

    // Immediate response — Telegram upload runs async
    state.status = 'uploading_to_telegram';
    res.json({ success: true, message: 'Upload finalizing to Telegram in background' });

    // Async Telegram upload — guarded by semaphore so max 3 run simultaneously
    (async () => {
        const release = await telegramSemaphore.acquire(); // ✅ blocks until slot available
        try {
            const client = await getDynamicClient(state.sessionString);

            if (!fs.existsSync(state.filePath)) {
                throw new Error('Upload temp file missing before Telegram upload');
            }

            // Compute hashes with a stream to avoid loading large files into RAM.
            const { sha256: serverHash, md5: serverMd5 } = await computeFileHashes(state.filePath);

            // Secondary server-side dedup (in case client hash was missing or mismatched)
            if (true) { // Always check at the end to be completely safe
                const existing = await pool.query(
                    `SELECT * FROM files WHERE (sha256_hash = $1 OR md5_hash = $2) AND user_id = $3 LIMIT 1`,
                    [serverHash, serverMd5, state.userId]
                );
                if (existing.rows.length > 0) {
                    if (fs.existsSync(state.filePath)) fs.unlinkSync(state.filePath);
                    state.status = 'completed';
                    state.progress = 100;
                    state.fileResult = formatFileRow(existing.rows[0]);
                    console.log(`[Upload] Server-side dedup: reused file id=${existing.rows[0].id}`);
                    setTimeout(() => { uploadState.delete(uploadId); }, 60 * 60 * 1000);
                    return;
                }
            }

            const progressCallback = (progress: number) => {
                state.progress = Math.round(progress * 100);
            };

            const customFile = new CustomFile(
                state.fileName,          // ✅ was state.originalname
                state.totalBytes,
                state.filePath
            );

            const uploadedMessage = await uploadToTelegramWithRetry(
                client,
                state.chatId,            // ✅ was state.telegram_chat_id
                {
                    file: customFile,
                    caption: `[Axya] ${state.fileName}`,
                    workers: 4, // parallel MTProto upload workers
                    progressCallback,
                }
            );

            if (!uploadedMessage) throw new Error('Upload failed after all retries.');

            const messageId = uploadedMessage.id;
            const fileId = uploadedMessage.document
                ? uploadedMessage.document.id.toString()
                : uploadedMessage.photo
                    ? uploadedMessage.photo.id.toString()
                    : '';

            const result = await pool.query(
                `INSERT INTO files (user_id, folder_id, file_name, file_size, telegram_file_id, telegram_message_id, telegram_chat_id, mime_type, sha256_hash, md5_hash)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
                [
                    state.userId,
                    state.folderId,         // ✅ was state.folder_id
                    state.fileName,         // ✅ was state.originalname
                    state.totalBytes,
                    fileId,
                    messageId,
                    state.chatId,           // ✅ was state.telegram_chat_id
                    state.mimeType,         // ✅ was state.mimetype
                    serverHash,
                    serverMd5,
                ]
            );

            if (fs.existsSync(state.filePath)) fs.unlinkSync(state.filePath);

            state.status = 'completed';
            state.progress = 100;
            state.fileResult = formatFileRow(result.rows[0]);

            setTimeout(() => { uploadState.delete(uploadId); }, 60 * 60 * 1000);

        } catch (err: any) {
            logger.error('backend.upload', 'telegram_upload_failed', {
                uploadId,
                userId: state.userId,
                fileName: state.fileName,
                message: err.message,
                stack: err.stack,
            });
            if (fs.existsSync(state.filePath)) {
                try { fs.unlinkSync(state.filePath); } catch { }
            }
            state.status = 'error';
            state.error = err.message || 'Unknown error';
        } finally {
            release(); // ✅ Always release semaphore slot, even on error
        }
    })();
};

// ─── Step 4: Poll Status ─────────────────────────────────────────────────────
export const checkUploadStatus = async (req: AuthRequest, res: Response) => {
    if (!req.user) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const { uploadId } = req.params;
    const state = uploadState.get(uploadId as string);

    if (!state) {
        return res.status(404).json({ success: false, error: 'Upload not found or expired' });
    }
    if (state.userId !== req.user.id) {
        return res.status(403).json({ success: false, error: 'Forbidden' });
    }

    return res.json({
        success: true,
        progress: state.progress,
        status: state.status,
        file: state.fileResult,
        error: state.error,
        receivedBytes: state.receivedBytes,
        totalBytes: state.totalBytes,
    });
};
