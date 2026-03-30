import { Response } from 'express';
import { AuthRequest } from '../middlewares/auth.middleware';
import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import pool from '../config/db';
import { getDynamicClient } from '../services/telegram.service';
import { CustomFile } from 'telegram/client/uploads';
import { logger } from '../utils/logger';
import { sendApiError } from '../utils/apiError';
import { formatFileRow, extractTelegramNativeMeta } from '../utils/formatters';
import sharp from 'sharp';
import { encode } from 'blurhash';

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

            // Fatal Session / Auth Errors
            if (/AUTH_KEY|SESSION_REVOKED|SESSION_EXPIRED|USER_DEACTIVATED|PHONE_MIGRATE/i.test(raw)) {
                console.error(`[Telegram] Fatal session error during upload. Aborting retries.`, raw);
                throw new Error('Telegram session expired or revoked. Please log in again.');
            }

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
const thumbnailSemaphore = new Semaphore(2); // max 2 concurrent thumbnail generations

const normalizeTelegramChatTarget = (value: unknown): string => {
    const raw = String(value || '').trim();
    if (!raw) return 'me';

    if (raw === 'me') return 'me';
    if (raw.startsWith('@')) return raw.slice(1);

    const linkMatch = raw.match(/^(?:https?:\/\/)?(?:t|telegram)\.me\/(.+)$/i);
    if (!linkMatch) return raw;

    const pathPart = linkMatch[1].split('?')[0].split('#')[0];
    const parts = pathPart.split('/').filter(Boolean);
    if (parts.length === 0) return 'me';

    // t.me/c/<internal_chat_id>/<message_id> -> channel peer id format
    if (parts[0] === 'c' && parts[1]) {
        return `-100${parts[1]}`;
    }

    // t.me/<username>/<message_id> -> use username peer
    if (parts[0]) {
        return parts[0].replace(/^@/, '');
    }

    return raw;
};

const getUploadSessionCandidates = (ownerSessionString: string, requestedChatId: unknown) => {
    const requested = normalizeTelegramChatTarget(requestedChatId);
    const storageChat = String(process.env.TELEGRAM_STORAGE_CHAT_ID || '').trim();

    // Fallbacks if personal session is invalid or they specifically use the bot
    const sessionCandidates = [
        String(process.env.TELEGRAM_STORAGE_SESSION || '').trim(),
        String(process.env.TELEGRAM_SESSION || '').trim(),
        String(ownerSessionString || '').trim(),
    ].filter(Boolean);

    const uniqueSessions = Array.from(new Set(sessionCandidates));
    return uniqueSessions.map((session) => {
        const isStorageSession =
            session === String(process.env.TELEGRAM_STORAGE_SESSION || '').trim()
            || session === String(process.env.TELEGRAM_SESSION || '').trim();

        // Critical FIX: If the user requested "me" but we are falling back to the global storage 
        // bot session, we MUST rewrite "me" to the bot's explicitly configured storage channel ID.
        // Otherwise, "me" routes to the bot's personal Saved Messages, breaking ID-mapping for the user.
        let targetChatId = requested || 'me';
        if (targetChatId === 'me' && isStorageSession && storageChat) {
            targetChatId = storageChat;
        }

        return {
            session,
            chatId: targetChatId,
        };
    });
};

const resolveUploadTransport = async (ownerSessionString: string, requestedChatId: unknown) => {
    const candidates = getUploadSessionCandidates(ownerSessionString, requestedChatId);
    let lastErr: any = null;

    for (const candidate of candidates) {
        try {
            await getDynamicClient(candidate.session);
            return candidate;
        } catch (err: any) {
            lastErr = err;
        }
    }

    throw lastErr || new Error('No Telegram session available for upload.');
};

// formatFileRow and extractTelegramNativeMeta imported from ../utils/formatters

const classifyUploadFailure = (err: unknown) => {
    const raw = String((err as any)?.message || '');
    if (/AUTH_KEY|SESSION_REVOKED|SESSION_EXPIRED|USER_DEACTIVATED|PHONE_MIGRATE/i.test(raw)) {
        return {
            code: 'telegram_session_expired',
            message: 'Telegram session expired. Please re-login.',
            retryable: false,
        };
    }
    if (/FLOOD_WAIT|NETWORK|TIMEOUT|ECONNRESET|ETIMEDOUT/i.test(raw)) {
        return {
            code: 'telegram_transient',
            message: 'Telegram is temporarily unavailable. Please retry.',
            retryable: true,
        };
    }
    return {
        code: 'internal_error',
        message: raw || 'Upload failed',
        retryable: false,
    };
};

type UploadLifecycleStatus = 'pending' | 'uploading' | 'completed' | 'cancelled' | 'failed';

type UploadSessionRow = {
    upload_id: string;
    user_id: string;
    file_name: string;
    mime_type: string | null;
    folder_id: string | null;
    telegram_chat_id: string;
    source_tag: string | null;
    total_bytes: string | number;
    chunk_size_bytes: number;
    total_chunks: number;
    uploaded_chunks: unknown;
    received_bytes: string | number;
    status: UploadLifecycleStatus;
    telegram_progress_percent: number;
    file_id: string | null;
    file_sha256: string | null;
    file_md5: string | null;
    temp_file_path: string;
    error_code: string | null;
    error_message: string | null;
    retryable: boolean;
    created_at: string;
    updated_at: string;
    completed_at: string | null;
};

type UploadChunkStats = {
    uploadedCount: number;
    uploadedBytes: number;
    uploadedChunks: number[];
};

const UPLOAD_TMP_ROOT = path.join(os.tmpdir(), 'axya_uploads');
const DEFAULT_CHUNK_SIZE_BYTES = 5 * 1024 * 1024;
const MIN_CHUNK_SIZE_BYTES = 512 * 1024;
const MAX_CHUNK_SIZE_BYTES = 8 * 1024 * 1024;
const MAX_ACTIVE_SESSION_FETCH = 250;
const FINALIZER_PROGRESS_UPDATE_THROTTLE_MS = 800;

const activeFinalizers = new Map<string, Promise<void>>();

const sanitizeUploadFileName = (value: string) =>
    String(value || '')
        .replace(/[\\/]/g, '_')
        .replace(/\s+/g, ' ')
        .trim() || 'upload.bin';

const normalizeChunkSize = (value: unknown): number => {
    const parsed = Number.parseInt(String(value ?? ''), 10);
    if (!Number.isFinite(parsed)) return DEFAULT_CHUNK_SIZE_BYTES;
    return Math.min(Math.max(parsed, MIN_CHUNK_SIZE_BYTES), MAX_CHUNK_SIZE_BYTES);
};

const toInt = (value: unknown): number => {
    if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
    const parsed = Number.parseInt(String(value ?? ''), 10);
    return Number.isFinite(parsed) ? parsed : 0;
};

const parseUploadedChunks = (value: unknown): number[] => {
    let source: unknown[] = [];
    if (Array.isArray(value)) {
        source = value;
    } else if (typeof value === 'string') {
        try {
            const parsed = JSON.parse(value || '[]');
            source = Array.isArray(parsed) ? parsed : [];
        } catch {
            source = [];
        }
    }
    const out = new Set<number>();
    for (const raw of source) {
        const parsed = toInt(raw);
        if (parsed >= 0) out.add(parsed);
    }
    return [...out].sort((a, b) => a - b);
};

const computeNextExpectedChunk = (totalChunks: number, uploadedChunks: number[]): number => {
    const uploaded = new Set(uploadedChunks);
    for (let i = 0; i < totalChunks; i += 1) {
        if (!uploaded.has(i)) return i;
    }
    return totalChunks;
};

const ensureTempUploadFile = (uploadId: string, fileName: string, totalBytes: number): string => {
    const safeName = sanitizeUploadFileName(fileName);
    const uploadDir = path.join(UPLOAD_TMP_ROOT, uploadId);
    const filePath = path.join(uploadDir, safeName);
    fs.mkdirSync(uploadDir, { recursive: true });
    const fd = fs.openSync(filePath, 'w');
    try {
        fs.ftruncateSync(fd, totalBytes);
    } finally {
        fs.closeSync(fd);
    }
    return filePath;
};

const cleanupSessionTempFile = (tempFilePath: string) => {
    try {
        const uploadDir = path.dirname(tempFilePath);
        if (uploadDir.startsWith(UPLOAD_TMP_ROOT)) {
            fs.rmSync(uploadDir, { recursive: true, force: true });
        } else if (fs.existsSync(tempFilePath)) {
            fs.unlinkSync(tempFilePath);
        }
    } catch {
        // best effort cleanup
    }
};

const sha256Hex = (buffer: Buffer): string => crypto.createHash('sha256').update(buffer).digest('hex');

const persistBufferChunk = async (tempFilePath: string, chunkIndex: number, chunkSize: number, chunkData: Buffer) => {
    const offset = chunkIndex * chunkSize;
    const handle = await fs.promises.open(tempFilePath, 'r+');
    try {
        await handle.write(chunkData, 0, chunkData.length, offset);
    } finally {
        await handle.close();
    }
};

const getUploadSessionById = async (uploadId: string): Promise<UploadSessionRow | null> => {
    const result = await pool.query('SELECT * FROM upload_sessions WHERE upload_id = $1 LIMIT 1', [uploadId]);
    return (result.rows[0] as UploadSessionRow) || null;
};

const getOwnedUploadSession = async (uploadId: string, userId: string): Promise<UploadSessionRow | null> => {
    const result = await pool.query(
        'SELECT * FROM upload_sessions WHERE upload_id = $1 AND user_id = $2 LIMIT 1',
        [uploadId, userId]
    );
    return (result.rows[0] as UploadSessionRow) || null;
};

const getChunkStats = async (uploadId: string): Promise<UploadChunkStats> => {
    const result = await pool.query(
        `SELECT
            COUNT(*)::int AS uploaded_count,
            COALESCE(SUM(chunk_size_bytes), 0)::bigint AS uploaded_bytes,
            COALESCE(jsonb_agg(chunk_index ORDER BY chunk_index), '[]'::jsonb) AS uploaded_chunks
         FROM upload_session_chunks
         WHERE upload_id = $1`,
        [uploadId]
    );
    const row = result.rows[0] || {};
    return {
        uploadedCount: toInt(row.uploaded_count),
        uploadedBytes: toInt(row.uploaded_bytes),
        uploadedChunks: parseUploadedChunks(row.uploaded_chunks),
    };
};

const calculateSessionProgress = (session: UploadSessionRow): number => {
    const totalBytes = Math.max(0, toInt(session.total_bytes));
    const receivedBytes = Math.max(0, toInt(session.received_bytes));
    const telegramProgress = Math.min(Math.max(toInt(session.telegram_progress_percent), 0), 100);

    if (session.status === 'completed') return 100;
    if (session.status === 'cancelled' || session.status === 'failed') {
        if (totalBytes === 0) return 0;
        return Math.min(Math.round((receivedBytes / totalBytes) * 50), 99);
    }

    const chunkPhase = totalBytes > 0
        ? Math.round(Math.min((receivedBytes / totalBytes) * 50, 50))
        : 0;

    if (receivedBytes >= totalBytes) {
        return Math.min(99, Math.max(50, Math.round(50 + (telegramProgress * 0.5))));
    }
    return chunkPhase;
};

const toClientUploadStatus = (session: UploadSessionRow): string => {
    if (session.status === 'failed') return 'error';
    if (session.status === 'uploading' && toInt(session.received_bytes) >= toInt(session.total_bytes)) {
        return 'uploading_to_telegram';
    }
    return session.status;
};

const toUploadStatusPayload = async (session: UploadSessionRow) => {
    const uploadedChunks = parseUploadedChunks(session.uploaded_chunks);
    const totalChunks = toInt(session.total_chunks);
    const nextExpectedChunk = computeNextExpectedChunk(totalChunks, uploadedChunks);

    let filePayload: any = null;
    if (session.file_id) {
        const fileRes = await pool.query('SELECT * FROM files WHERE id = $1 LIMIT 1', [session.file_id]);
        if (fileRes.rows.length > 0) {
            filePayload = formatFileRow(fileRes.rows[0]);
        }
    }

    return {
        success: true,
        progress: calculateSessionProgress(session),
        status: toClientUploadStatus(session),
        file: filePayload,
        error: session.error_message,
        errorCode: session.error_code,
        code: session.error_code,
        retryable: Boolean(session.retryable),
        receivedBytes: toInt(session.received_bytes),
        totalBytes: toInt(session.total_bytes),
        uploadedChunks,
        uploadedChunksCount: uploadedChunks.length,
        totalChunks,
        nextExpectedChunk,
        uploadId: session.upload_id,
        updatedAt: session.updated_at,
    };
};

const saveChunkMetricsToSession = async (uploadId: string, status: UploadLifecycleStatus = 'uploading') => {
    const stats = await getChunkStats(uploadId);
    await pool.query(
        `UPDATE upload_sessions
         SET uploaded_chunks = $2::jsonb,
             received_bytes = $3,
             status = $4,
             updated_at = NOW()
         WHERE upload_id = $1`,
        [uploadId, JSON.stringify(stats.uploadedChunks), stats.uploadedBytes, status]
    );
    return stats;
};

const updateSessionFailure = async (uploadId: string, code: string, message: string, retryable: boolean) => {
    await pool.query(
        `UPDATE upload_sessions
         SET status = 'failed',
             error_code = $2,
             error_message = $3,
             retryable = $4,
             updated_at = NOW()
         WHERE upload_id = $1`,
        [uploadId, code, message, retryable]
    );
};

export const listUploadSessions = async (req: AuthRequest, res: Response) => {
    if (!req.user) return res.status(401).json({ success: false, error: 'Unauthorized' });
    const includeCompleted = String(req.query.include_completed || '').trim() === '1';

    const query = includeCompleted
        ? `SELECT * FROM upload_sessions WHERE user_id = $1 ORDER BY updated_at DESC LIMIT $2`
        : `SELECT *
           FROM upload_sessions
           WHERE user_id = $1
             AND (status IN ('pending', 'uploading', 'failed', 'cancelled') OR updated_at > NOW() - INTERVAL '24 hours')
           ORDER BY updated_at DESC
           LIMIT $2`;

    const sessionsRes = await pool.query(query, [req.user.id, MAX_ACTIVE_SESSION_FETCH]);
    const payload = await Promise.all(
        sessionsRes.rows.map((row) => toUploadStatusPayload(row as UploadSessionRow))
    );

    return res.json({ success: true, sessions: payload.map((item) => item) });
};

// ─── Step 1: Init Upload ────────────────────────────────────────────────────
// Checks file hash first; if duplicate exists, returns existing file immediately.
export const initUpload = async (req: AuthRequest, res: Response) => {
    if (!req.user) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const { originalname, size, mimetype, folder_id, telegram_chat_id, hash, source_tag, chunk_size_bytes } = req.body;

    if (!originalname || size === undefined || size === null) {
        return res.status(400).json({ success: false, error: 'Missing file info (originalname, size required)' });
    }

    const fileName = sanitizeUploadFileName(String(originalname));
    const fileSize = toInt(size);
    if (fileSize <= 0) {
        return res.status(400).json({ success: false, error: 'File size must be greater than 0 bytes' });
    }

    const chunkSize = normalizeChunkSize(chunk_size_bytes);
    const totalChunks = Math.max(1, Math.ceil(fileSize / chunkSize));

    let uploadTransport: { session: string; chatId: string };
    try {
        uploadTransport = await resolveUploadTransport(req.user.sessionString, telegram_chat_id);
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
                        `INSERT INTO files (user_id, folder_id, file_name, file_size, telegram_file_id, telegram_message_id, telegram_chat_id, mime_type, sha256_hash, md5_hash, blurhash, tg_media_meta, tg_duration_sec, tg_width, tg_height, tg_caption, tg_source_tag)
                         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13, $14, $15, $16, $17)
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

    const uploadId = crypto.randomUUID();
    let tempFilePath = '';
    try {
        tempFilePath = ensureTempUploadFile(uploadId, fileName, fileSize);
        await pool.query(
            `INSERT INTO upload_sessions (
                upload_id, user_id, file_name, mime_type, folder_id, telegram_chat_id, source_tag,
                total_bytes, chunk_size_bytes, total_chunks, uploaded_chunks, received_bytes,
                status, telegram_progress_percent, temp_file_path
            ) VALUES (
                $1, $2, $3, $4, $5, $6, $7,
                $8, $9, $10, $11::jsonb, 0,
                'pending', 0, $12
            )`,
            [
                uploadId,
                req.user.id,
                fileName,
                mimetype || 'application/octet-stream',
                folder_id || null,
                uploadTransport.chatId,
                String(source_tag || '').trim().toLowerCase() || null,
                fileSize,
                chunkSize,
                totalChunks,
                JSON.stringify([]),
                tempFilePath,
            ]
        );

        logger.info('backend.upload', 'upload_started', {
            uploadId,
            userId: req.user.id,
            fileName,
            totalBytes: fileSize,
            chunkSize,
            totalChunks,
        });

        return res.json({
            success: true,
            uploadId,
            duplicate: false,
            chunkSizeBytes: chunkSize,
            totalChunks,
        });
    } catch (err: any) {
        if (tempFilePath) cleanupSessionTempFile(tempFilePath);
        logger.error('backend.upload', 'upload_init_failed', {
            userId: req.user.id,
            fileName,
            message: err?.message,
            stack: err?.stack,
        });
        return res.status(500).json({ success: false, error: 'Could not initialize upload session' });
    }
};

// ─── Step 2: Upload Chunk ───────────────────────────────────────────────────
export const uploadChunk = async (req: AuthRequest, res: Response) => {
    if (!req.user) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const uploadId = String(req.body.uploadId || '').trim();
    const chunkIndex = toInt(req.body.chunkIndex);
    const chunkBase64 = req.body.chunkBase64;
    const clientChunkHash = String(req.body.chunkHash || '').trim().toLowerCase();

    if (!uploadId) return res.status(400).json({ success: false, error: 'Missing uploadId' });
    if (!req.file && !chunkBase64) {
        return res.status(400).json({ success: false, error: 'No chunk data provided' });
    }

    const session = await getOwnedUploadSession(uploadId, req.user.id);
    if (!session) {
        return res.status(404).json({ success: false, error: 'Upload session not found' });
    }

    if (session.status === 'completed') {
        const payload = await toUploadStatusPayload(session);
        return res.json(payload);
    }
    if (session.status === 'cancelled') {
        return res.status(409).json({ success: false, error: 'Upload has been cancelled', code: 'UPLOAD_CANCELLED' });
    }
    if (session.status === 'failed') {
        return res.status(409).json({ success: false, error: 'Upload is in failed state. Restart required.', code: 'UPLOAD_FAILED' });
    }

    const totalChunks = toInt(session.total_chunks);
    if (chunkIndex < 0 || chunkIndex >= totalChunks) {
        return res.status(400).json({ success: false, error: `chunkIndex out of range (0..${Math.max(totalChunks - 1, 0)})` });
    }

    let chunkData: Buffer;
    try {
        if (req.file?.path) {
            chunkData = await fs.promises.readFile(req.file.path);
        } else {
            chunkData = Buffer.from(String(chunkBase64 || ''), 'base64');
        }
    } catch (err: any) {
        if (req.file?.path && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        return res.status(400).json({ success: false, error: err?.message || 'Invalid chunk payload' });
    } finally {
        if (req.file?.path && fs.existsSync(req.file.path)) {
            try { fs.unlinkSync(req.file.path); } catch { }
        }
    }

    const totalBytes = toInt(session.total_bytes);
    const chunkSize = toInt(session.chunk_size_bytes);
    const expectedChunkLength = chunkIndex === totalChunks - 1
        ? Math.max(totalBytes - (chunkIndex * chunkSize), 0)
        : chunkSize;

    if (chunkData.length !== expectedChunkLength) {
        return res.status(422).json({
            success: false,
            error: `Chunk length mismatch for index ${chunkIndex}. Expected ${expectedChunkLength}, got ${chunkData.length}`,
            code: 'CHUNK_LENGTH_MISMATCH',
        });
    }

    const serverChunkHash = sha256Hex(chunkData);
    if (clientChunkHash && clientChunkHash !== serverChunkHash) {
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
        const sameSize = toInt(existing.chunk_size_bytes) === chunkData.length;
        if (!sameHash || !sameSize) {
            return res.status(409).json({
                success: false,
                error: `Conflicting retry for chunk ${chunkIndex}`,
                code: 'CHUNK_CONFLICT',
            });
        }

        const stats = await getChunkStats(uploadId);
        const nextExpectedChunk = computeNextExpectedChunk(totalChunks, stats.uploadedChunks);
        return res.json({
            success: true,
            duplicate: true,
            receivedBytes: stats.uploadedBytes,
            totalBytes,
            uploadedChunksCount: stats.uploadedCount,
            totalChunks,
            nextExpectedChunk,
        });
    }

    if (!fs.existsSync(session.temp_file_path)) {
        await updateSessionFailure(uploadId, 'temp_file_missing', 'Upload temp file is missing. Restart required.', false);
        return res.status(410).json({
            success: false,
            error: 'Upload partial data unavailable. Please restart upload.',
            code: 'TEMP_FILE_MISSING',
            retryable: false,
        });
    }

    try {
        await persistBufferChunk(session.temp_file_path, chunkIndex, chunkSize, chunkData);

        await pool.query(
            `INSERT INTO upload_session_chunks (upload_id, chunk_index, chunk_size_bytes, chunk_hash_sha256)
             VALUES ($1, $2, $3, $4)`,
            [uploadId, chunkIndex, chunkData.length, serverChunkHash]
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
                return res.status(409).json({ success: false, error: 'Chunk race detected; please retry', code: 'CHUNK_RACE' });
            }
            const sameHash = String(retryChunk.chunk_hash_sha256 || '') === serverChunkHash;
            const sameSize = toInt(retryChunk.chunk_size_bytes) === chunkData.length;
            if (!sameHash || !sameSize) {
                return res.status(409).json({ success: false, error: 'Conflicting chunk race', code: 'CHUNK_CONFLICT' });
            }
        } else {
            logger.error('backend.upload', 'chunk_persist_failed', {
                uploadId,
                userId: req.user.id,
                chunkIndex,
                message: err?.message,
            });
            return res.status(500).json({ success: false, error: 'Failed to persist chunk' });
        }
    }

    const stats = await saveChunkMetricsToSession(uploadId, 'uploading');
    const nextExpectedChunk = computeNextExpectedChunk(totalChunks, stats.uploadedChunks);

    logger.info('backend.upload', 'chunk_uploaded', {
        uploadId,
        userId: req.user.id,
        chunkIndex,
        chunkBytes: chunkData.length,
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
    });
};

const finalizeUploadSession = async (uploadId: string, ownerSessionString: string) => {
    const release = await telegramSemaphore.acquire();
    try {
        const session = await getUploadSessionById(uploadId);
        if (!session) return;
        if (session.status === 'completed' || session.status === 'cancelled') return;

        const chunkStats = await getChunkStats(uploadId);
        const totalChunks = toInt(session.total_chunks);
        if (chunkStats.uploadedCount < totalChunks) {
            await updateSessionFailure(uploadId, 'missing_chunks', 'Upload is incomplete. Missing chunks before finalize.', true);
            return;
        }

        if (!fs.existsSync(session.temp_file_path)) {
            await updateSessionFailure(uploadId, 'temp_file_missing', 'Upload temp file missing during finalize.', false);
            return;
        }

        const { sha256: serverHash, md5: serverMd5 } = await computeFileHashes(session.temp_file_path);

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
            return;
        }

        const uploadTransport = await resolveUploadTransport(ownerSessionString, session.telegram_chat_id);
        const client = await getDynamicClient(uploadTransport.session);

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
                 WHERE upload_id = $1 AND status = 'uploading'`,
                [uploadId, next]
            ).catch(() => undefined);
        };

        const customFile = new CustomFile(session.file_name, toInt(session.total_bytes), session.temp_file_path);
        const uploadedMessage = await uploadToTelegramWithRetry(
            client,
            uploadTransport.chatId,
            {
                file: customFile,
                caption: `[Axya] ${session.file_name}`,
                workers: 4,
                progressCallback,
            }
        );

        if (!uploadedMessage) {
            throw new Error('Telegram upload returned no message');
        }

        const latestSession = await getUploadSessionById(uploadId);
        if (!latestSession || latestSession.status === 'cancelled') {
            cleanupSessionTempFile(session.temp_file_path);
            return;
        }

        const messageId = uploadedMessage.id;
        const telegramFileId = uploadedMessage.document
            ? uploadedMessage.document.id.toString()
            : uploadedMessage.photo
                ? uploadedMessage.photo.id.toString()
                : '';
        const nativeMeta = extractTelegramNativeMeta(uploadedMessage);

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
                            .resize(1080, 1080, { fit: 'inside', withoutEnlargement: true })
                            .toFormat('webp', { quality: 85, effort: 3 })
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
        const insertResult = await pool.query(
            `INSERT INTO files (user_id, folder_id, file_name, file_size, telegram_file_id, telegram_message_id, telegram_chat_id, mime_type, sha256_hash, md5_hash, blurhash, tg_media_meta, tg_duration_sec, tg_width, tg_height, tg_caption, tg_source_tag)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13, $14, $15, $16, $17)
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
                uploadTransport.chatId,
                session.mime_type || 'application/octet-stream',
                serverHash,
                serverMd5,
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
            if (existingRes.rows.length > 0) fileRow = existingRes.rows[0];
        }

        if (fileRow && finalThumbBuffer) {
            try {
                const thumbDir = path.join(os.tmpdir(), 'axya_thumbs');
                fs.mkdirSync(thumbDir, { recursive: true });
                // Save with both generic and width-specific naming for cache compatibility
                fs.writeFileSync(path.join(thumbDir, `${fileRow.id}.webp`), finalThumbBuffer);
                fs.writeFileSync(path.join(thumbDir, `${fileRow.id}_1080.webp`), finalThumbBuffer);
                // Generate a 240px micro-thumbnail for instant file list loading
                try {
                    const microThumb = await sharp(finalThumbBuffer, { failOnError: false })
                        .resize(240, 240, { fit: 'inside', withoutEnlargement: true })
                        .toFormat('webp', { quality: 70, effort: 2 })
                        .toBuffer();
                    fs.writeFileSync(path.join(thumbDir, `${fileRow.id}_240.webp`), microThumb);
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
    } catch (err: any) {
        const mapped = classifyUploadFailure(err);
        await updateSessionFailure(uploadId, mapped.code, mapped.message, mapped.retryable);
        logger.error('backend.upload', 'upload_failed', {
            uploadId,
            message: err?.message,
            stack: err?.stack,
            code: mapped.code,
            retryable: mapped.retryable,
        });
    } finally {
        release();
    }
};

const startUploadFinalizer = (uploadId: string, ownerSessionString: string) => {
    if (activeFinalizers.has(uploadId)) return;
    const promise = finalizeUploadSession(uploadId, ownerSessionString)
        .catch((err) => {
            logger.error('backend.upload', 'finalizer_crashed', {
                uploadId,
                message: err?.message,
                stack: err?.stack,
            });
        })
        .finally(() => {
            activeFinalizers.delete(uploadId);
        });
    activeFinalizers.set(uploadId, promise);
};

// ─── Step 3: Complete Upload ────────────────────────────────────────────────
export const completeUpload = async (req: AuthRequest, res: Response) => {
    if (!req.user) return res.status(401).json({ success: false, error: 'Unauthorized' });
    const correlationId = String(req.headers['x-correlation-id'] || crypto.randomUUID());
    const idempotencyKey = String(req.headers['idempotency-key'] || '').trim() || undefined;

    const uploadId = String(req.body.uploadId || '').trim();
    if (!uploadId) return res.status(400).json({ success: false, error: 'Missing uploadId' });

    const session = await getOwnedUploadSession(uploadId, req.user.id);
    if (!session) return res.status(404).json({ success: false, error: 'Upload session not found' });

    if (session.status === 'completed') {
        return res.json({ success: true, message: 'Already completed', correlation_id: correlationId, idempotency_key: idempotencyKey });
    }
    if (session.status === 'cancelled') {
        return res.status(409).json({ success: false, error: 'Upload is cancelled', code: 'UPLOAD_CANCELLED' });
    }

    const chunkStats = await getChunkStats(uploadId);
    const totalChunks = toInt(session.total_chunks);
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
         SET status = 'uploading',
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

    return res.json({
        success: true,
        message: 'Upload finalizing to Telegram in background',
        correlation_id: correlationId,
        idempotency_key: idempotencyKey,
    });
};

// ─── Step 4: Cancel Upload ───────────────────────────────────────────────────
export const cancelUpload = async (req: AuthRequest, res: Response) => {
    if (!req.user) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const uploadId = String(req.body.uploadId || '').trim();
    if (!uploadId) return res.status(400).json({ success: false, error: 'Missing uploadId' });

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

    if (!activeFinalizers.has(uploadId)) {
        cleanupSessionTempFile(session.temp_file_path);
    }

    logger.info('backend.upload', 'upload_cancelled', {
        uploadId,
        userId: req.user.id,
        fileName: session.file_name,
    });

    return res.json({ success: true, message: 'Upload cancelled' });
};

// ─── Step 5: Poll Status ─────────────────────────────────────────────────────
export const checkUploadStatus = async (req: AuthRequest, res: Response) => {
    if (!req.user) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const uploadId = String(req.params.uploadId || '').trim();
    if (!uploadId) return res.status(400).json({ success: false, error: 'Missing uploadId' });

    const session = await getOwnedUploadSession(uploadId, req.user.id);
    if (!session) {
        return res.status(404).json({ success: false, error: 'Upload not found or expired' });
    }

    const payload = await toUploadStatusPayload(session);
    return res.json(payload);
};
