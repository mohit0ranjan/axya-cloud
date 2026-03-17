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

// ─── Upload State (in-memory, auto-cleans after 1h) ─────────────────────────
export const uploadState = new Map<string, any>();

// Auto-evict completed/failed sessions older than 1h (prevent memory leak)
setInterval(() => {
    if (uploadState.size === 0) return;
    const now = Date.now();
    for (const [id, state] of uploadState.entries()) {
        // Evict after 1 hour
        if (['completed', 'error', 'failed'].includes(state.status) && now - state.startedAt > 60 * 60 * 1000) {
            if (state.filePath) {
                try { fs.rmSync(path.dirname(state.filePath), { recursive: true, force: true }); } catch { }
            }
            uploadState.delete(id);
        }
    }
}, 10 * 60 * 1000); // Run garbage collection every 10 minutes

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

// ─── Step 1: Init Upload ────────────────────────────────────────────────────
// Checks hash first → if duplicate, returns existing file immediately.
export const initUpload = async (req: AuthRequest, res: Response) => {
    if (!req.user) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const { originalname, size, mimetype, folder_id, telegram_chat_id, hash, source_tag } = req.body;

    if (!originalname || size === undefined || size === null) {
        return res.status(400).json({ success: false, error: 'Missing file info (originalname, size required)' });
    }

    // Fast-fail if no usable Telegram session before spending bandwidth on chunks.
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

    // ── Deduplication: check hash in DB ────────────────────────────────────
    if (hash) {
        try {
            let existing;
            if (hash.length === 64) {
                existing = await pool.query(
                    `SELECT * FROM files WHERE sha256_hash = $1 AND user_id = $2 AND is_trashed = false LIMIT 1`,
                    [hash, req.user.id]
                );
            } else if (hash.length === 32) {
                existing = await pool.query(
                    `SELECT * FROM files WHERE md5_hash = $1 AND user_id = $2 AND is_trashed = false LIMIT 1`,
                    [hash, req.user.id]
                );
            } else {
                existing = await pool.query(
                    `SELECT * FROM files WHERE (sha256_hash = $1 OR md5_hash = $1) AND user_id = $2 AND is_trashed = false LIMIT 1`,
                    [hash, req.user.id]
                );
            }

            if (existing.rows.length > 0) {
                const existingFile = existing.rows[0];

                // If a target folder is different from existing, create a reference row
                const effectiveFolderId = folder_id || null;
                if (effectiveFolderId && effectiveFolderId !== existingFile.folder_id) {
                    // Insert a new DB row that reuses the same telegram_file_id
                    const newFileRes = await pool.query(
                        `INSERT INTO files (user_id, folder_id, file_name, file_size, telegram_file_id, telegram_message_id, telegram_chat_id, mime_type, sha256_hash, md5_hash, blurhash, tg_media_meta, tg_duration_sec, tg_width, tg_height, tg_caption, tg_source_tag)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13, $14, $15, $16, $17) RETURNING *`,
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

    // ── Storage Quota Check (Unlimited Storage) ────────────────────────────────
    // Axya now supports unlimited storage - quota check disabled
    // Keeping the code structure for potential future plan limits
    const fileSize = parseInt(size, 10);
    const quotaCheckEnabled = process.env.STORAGE_QUOTA_ENABLED === 'true';

    if (quotaCheckEnabled) {
        try {
            const quotaCheck = await pool.query(
                'SELECT storage_used_bytes, storage_quota_bytes FROM users WHERE id = $1',
                [req.user.id]
            );

            if (quotaCheck.rows.length > 0) {
                const { storage_used_bytes, storage_quota_bytes } = quotaCheck.rows[0];
                if (storage_used_bytes + fileSize > storage_quota_bytes) {
                    const usedMB = Math.round(storage_used_bytes / (1024 * 1024));
                    const quotaMB = Math.round(storage_quota_bytes / (1024 * 1024));
                    const neededMB = Math.round(fileSize / (1024 * 1024));
                    return res.status(413).json({
                        success: false,
                        error: `Storage quota exceeded. Used: ${usedMB}MB, Quota: ${quotaMB}MB, Needed: ${neededMB}MB`,
                        code: 'QUOTA_EXCEEDED',
                        storage_used: storage_used_bytes,
                        storage_quota: storage_quota_bytes,
                    });
                }
            }
        } catch (quotaErr: any) {
            console.warn('[Upload] Quota check failed (non-fatal):', quotaErr.message);
            // Continue with upload if quota check fails - fail open
        }
    }

    // ── No duplicate, proceed with upload ──────────────────────────────────
    const uploadId = crypto.randomUUID();
    const uploadDir = path.join(os.tmpdir(), 'axya_uploads', uploadId);
    const filePath = path.join(uploadDir, originalname);
    fs.mkdirSync(uploadDir, { recursive: true });

    // Eagerly guarantee file existence to fix 0-byte missing file errors
    fs.closeSync(fs.openSync(filePath, 'w'));

    // Mark upload session
    uploadState.set(uploadId, {
        userId: req.user.id,
        sessionString: uploadTransport!.session,
        filePath,
        fileName: originalname,
        fileSize: fileSize,
        mimeType: mimetype || 'application/octet-stream',
        folderId: folder_id || null,
        chatId: uploadTransport!.chatId,
        sourceTag: String(source_tag || '').trim().toLowerCase() || null,
        totalBytes: fileSize,
        receivedBytes: 0,
        nextExpectedChunk: 0, // ✅ Fix 4: chunk ordering guard
        status: 'initialized',
        progress: 0,
        startedAt: Date.now(), // ✅ track for eviction
    });

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

    // ✅ Fix 4: Validate chunk arrives in expected order
    const idx = parseInt(chunkIndex, 10);
    if (state.nextExpectedChunk !== undefined && idx !== state.nextExpectedChunk) {
        if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        return res.status(409).json({ success: false, error: `Expected chunk ${state.nextExpectedChunk}, got ${idx}` });
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
        state.nextExpectedChunk = idx + 1; // ✅ advance expected index

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
    const correlationId = String(req.headers['x-correlation-id'] || crypto.randomUUID());
    const idempotencyKey = String(req.headers['idempotency-key'] || '').trim() || undefined;

    const { uploadId } = req.body;
    if (!uploadId) return res.status(400).json({ success: false, error: 'Missing uploadId' });

    const state = uploadState.get(uploadId);
    if (!state) return res.status(404).json({ success: false, error: 'Upload session not found' });
    if (state.userId !== req.user.id) return res.status(403).json({ success: false, error: 'Forbidden' });

    // ✅ Fix 1: Idempotency guard — prevent duplicate Telegram uploads on retried /complete
    if (state.status !== 'initialized') {
        return res.json({ success: true, message: 'Already processing', correlation_id: correlationId, idempotency_key: idempotencyKey });
    }

    // ✅ Reject 0-byte uploads — prevents FILE_PARTS_INVALID from Telegram
    if (state.receivedBytes === 0) {
        state.status = 'error';
        state.error = 'No data received — file is 0 bytes';
        return res.status(400).json({ success: false, error: 'No data received — cannot upload an empty file' });
    }

    // Immediate response — Telegram upload runs async
    state.status = 'uploading_to_telegram';
    res.json({
        success: true,
        message: 'Upload finalizing to Telegram in background',
        correlation_id: correlationId,
        idempotency_key: idempotencyKey,
    });

    // Async Telegram upload — guarded by semaphore so max 3 run simultaneously
    (async () => {
        const release = await telegramSemaphore.acquire();
        try {
            // ── Cancellation check 1: Before hash compute ──────────────────
            if (state.status === 'cancelled') {
                cleanupUpload(state, uploadId);
                return;
            }

            const client = await getDynamicClient(state.sessionString);

            if (!fs.existsSync(state.filePath)) {
                throw new Error('Upload temp file missing before Telegram upload');
            }

            const { sha256: serverHash, md5: serverMd5 } = await computeFileHashes(state.filePath);

            // ── Cancellation check 2: Before Telegram upload ───────────────
            if (state.status === 'cancelled') {
                cleanupUpload(state, uploadId);
                return;
            }

            // ── Pre-upload dedup (before hitting Telegram) ──────────────────
            const preCheck = await pool.query(
                `SELECT * FROM files WHERE (sha256_hash = $1 OR md5_hash = $2) AND user_id = $3 AND is_trashed = false LIMIT 1`,
                [serverHash, serverMd5, state.userId]
            );
            if (preCheck.rows.length > 0) {
                cleanupUpload(state, uploadId);
                state.status = 'completed';
                state.progress = 100;
                state.fileResult = formatFileRow(preCheck.rows[0]);
                console.log(`[Upload] Pre-upload dedup: reused file id=${preCheck.rows[0].id}`);
                return;
            }

            // ── Upload to Telegram ───────────────────────────────────────────
            const progressCallback = (progress: number) => {
                state.progress = Math.round(progress * 100);
            };

            const customFile = new CustomFile(state.fileName, state.totalBytes, state.filePath);

            const uploadedMessage = await uploadToTelegramWithRetry(
                client,
                state.chatId,
                {
                    file: customFile,
                    caption: `[Axya] ${state.fileName}`,
                    // ⚠️ `workers: 4` concurrently multiplexes the MTProto chunk upload.
                    // This is ONLY safe because `useWSS: false` is hardcoded in `telegram.service.ts`.
                    // Using parallel workers with WebSockets in GramJS will deadlock the Node thread.
                    workers: 4,
                    progressCallback,
                }
            );

            if (!uploadedMessage) throw new Error('Upload failed after all retries.');

            // ── Cancellation check 3: Before DB insert ─────────────────────
            if (state.status === 'cancelled') {
                cleanupUpload(state, uploadId);
                return;
            }

            const messageId = uploadedMessage.id;
            const telegramFileId = uploadedMessage.document
                ? uploadedMessage.document.id.toString()
                : uploadedMessage.photo
                    ? uploadedMessage.photo.id.toString()
                    : '';
            const nativeMeta = extractTelegramNativeMeta(uploadedMessage);

            // ── Insert with ON CONFLICT + 23505 catch ───────────────────────
            // ── Pre-generate Thumbnail & BlurHash ──────────────────
            let finalBlurhash = null;
            let finalThumbBuffer: Buffer | null = null;

            if (state.mimeType.startsWith('image/') && state.totalBytes < 20 * 1024 * 1024) {
                try {
                    const releaseThumb = await thumbnailSemaphore.acquire();
                    try {
                        const image = sharp(state.filePath);
                        const metadata = await image.metadata();

                        if (metadata.width && metadata.height) {
                            // Blurhash needs a small raw buffer
                            const { data, info } = await sharp(state.filePath)
                                .raw()
                                .ensureAlpha()
                                .resize(32, 32, { fit: 'inside' })
                                .toBuffer({ resolveWithObject: true });
                            finalBlurhash = encode(new Uint8ClampedArray(data), info.width, info.height, 4, 3);

                            // WebP thumb
                            finalThumbBuffer = await sharp(state.filePath, { failOnError: false })
                                .resize(1080, 1080, { fit: 'inside', withoutEnlargement: true })
                                .toFormat('webp', { quality: 85, effort: 3 })
                                .toBuffer();
                        }
                    } finally {
                        releaseThumb();
                    }
                } catch (e: any) {
                    console.warn(`[Upload] Thumb/Blurhash pre-generation failed:`, e.message);
                }
            }

            // ── Insert with ON CONFLICT + 23505 catch ───────────────────────
            let fileResult: any = null;
            try {
                const result = await pool.query(
                    `INSERT INTO files (user_id, folder_id, file_name, file_size, telegram_file_id, telegram_message_id, telegram_chat_id, mime_type, sha256_hash, md5_hash, blurhash, tg_media_meta, tg_duration_sec, tg_width, tg_height, tg_caption, tg_source_tag)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13, $14, $15, $16, $17)
         ON CONFLICT (user_id, sha256_hash) WHERE sha256_hash IS NOT NULL AND is_trashed = false
         DO NOTHING
         RETURNING *`,
                    [
                        state.userId,
                        state.folderId,
                        state.fileName,
                        state.totalBytes,
                        telegramFileId,
                        messageId,
                        state.chatId,
                        state.mimeType,
                        serverHash,
                        serverMd5,
                        finalBlurhash,
                        JSON.stringify(nativeMeta.mediaMeta || {}),
                        nativeMeta.durationSec,
                        nativeMeta.width,
                        nativeMeta.height,
                        nativeMeta.caption,
                        state.sourceTag,
                    ]
                );

                if (result.rows.length === 0) {
                    // ON CONFLICT DO NOTHING fired — fetch existing row
                    const existing = await pool.query(
                        `SELECT * FROM files WHERE sha256_hash = $1 AND user_id = $2 AND is_trashed = false LIMIT 1`,
                        [serverHash, state.userId]
                    );
                    fileResult = existing.rows.length > 0 ? formatFileRow(existing.rows[0]) : null;
                    console.log(`[Upload] Conflict dedup: reused file sha256=${serverHash}`);
                } else {
                    fileResult = formatFileRow(result.rows[0]);
                }
            } catch (insertErr: any) {
                if (insertErr.code === '23505') {
                    console.warn(`[Upload] Caught 23505 unique_violation for "${state.fileName}" — fetching existing row`);
                    const existing = await pool.query(
                        `SELECT * FROM files WHERE user_id = $1 AND file_name = $2 AND is_trashed = false ORDER BY created_at DESC LIMIT 1`,
                        [state.userId, state.fileName]
                    );
                    fileResult = existing.rows.length > 0 ? formatFileRow(existing.rows[0]) : null;
                } else {
                    throw insertErr; // Re-throw non-duplicate errors
                }
            }

            if (fileResult && finalThumbBuffer) {
                try {
                    const THUMB_DIR = path.join(os.tmpdir(), 'axya_thumbs');
                    fs.mkdirSync(THUMB_DIR, { recursive: true });
                    fs.writeFileSync(path.join(THUMB_DIR, `${fileResult.id}.webp`), finalThumbBuffer);
                } catch (e: any) {
                    console.warn('[Upload] Failed to save thumb to disk:', e.message);
                }
            }

            cleanupUpload(state, uploadId);
            state.status = 'completed';
            state.progress = 100;
            state.fileResult = fileResult;

        } catch (err: any) {
            const mapped = classifyUploadFailure(err);
            logger.error('backend.upload', 'telegram_upload_failed', {
                uploadId,
                userId: state.userId,
                fileName: state.fileName,
                message: err.message,
                stack: err.stack,
                code: mapped.code,
                retryable: mapped.retryable,
            });
            cleanupUpload(state, uploadId);
            state.status = 'error';
            state.error = mapped.message;
            state.errorCode = mapped.code;
            state.retryable = mapped.retryable;
        } finally {
            release();
        }
    })();
};

// ─── Helper: cleanup temp files ──────────────────────────────────────────────
const cleanupUpload = (state: any, uploadId: string) => {
    if (state.filePath) {
        try { fs.rmSync(path.dirname(state.filePath), { recursive: true, force: true }); } catch { }
    }
    // Schedule state eviction (keep for status polling, then auto-delete)
    setTimeout(() => { uploadState.delete(uploadId); }, 60 * 60 * 1000);
};

// ─── Step 4: Cancel Upload ───────────────────────────────────────────────────
export const cancelUpload = async (req: AuthRequest, res: Response) => {
    if (!req.user) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const { uploadId } = req.body;
    if (!uploadId) return res.status(400).json({ success: false, error: 'Missing uploadId' });

    const state = uploadState.get(uploadId);
    if (!state) return res.json({ success: true, message: 'Upload session not found or already cleaned up' });
    if (state.userId !== req.user.id) return res.status(403).json({ success: false, error: 'Forbidden' });

    // Mark as cancelled — the async IIFE checks this flag at key points
    state.status = 'cancelled';
    console.log(`[Upload] Cancel requested for uploadId=${uploadId} file="${state.fileName}"`);

    // Clean up temp files immediately
    if (state.filePath) {
        try { fs.rmSync(path.dirname(state.filePath), { recursive: true, force: true }); } catch { }
    }

    return res.json({ success: true, message: 'Upload cancelled' });
};

// ─── Step 5: Poll Status ─────────────────────────────────────────────────────
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
        errorCode: state.errorCode,
        code: state.errorCode,
        retryable: Boolean(state.retryable),
        receivedBytes: state.receivedBytes,
        totalBytes: state.totalBytes,
    });
};
