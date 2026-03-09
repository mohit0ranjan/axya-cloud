/**
 * stream.controller.ts — Cached video streaming
 *
 * GET /stream/:fileId         — Stream with Range support
 * GET /stream/:fileId/status  — Cache/download status
 *
 * Strategy: Download-first, serve-from-cache
 *
 * WHY NOT progressive/instant streaming?
 * Mobile video players (expo-video, AVPlayer, ExoPlayer) send many Range requests.
 * Each Range request on a partial file would require knowing the exact available bytes,
 * and players timeout ~5s with no data. Download-first-then-stream is reliable.
 *
 * HOW IT WORKS:
 * - First play: download full file to /tmp disk cache, then serve
 * - Subsequent plays: served instantly from cache (zero Telegram calls)
 * - Cache auto-expires after 1 hour
 * - Range requests served instantly via fs.createReadStream({ start, end })
 *
 * ✅ HTTP Range support (206 Partial Content)
 * ✅ Disk-cached: download once, stream many times
 * ✅ JWT-protected + user ownership validation
 * ✅ FIX C2: In-memory ownership cache (60s TTL) — avoids DB query on every 2s poll
 * ✅ FIX M1: req.on('close') destroys read stream on client disconnect
 * ✅ Concurrent-safe: in-flight download locks
 * ✅ Auto-cleanup of stale cache files
 */

import { Response } from 'express';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { AuthRequest } from '../middlewares/auth.middleware';
import { getDynamicClient } from '../services/telegram.service';
import pool from '../config/db';
import { logger } from '../utils/logger';
import { sendApiError } from '../utils/apiError';
import { mapTelegramError } from '../utils/telegramErrors';
import { hashSessionForCache, rememberPreferredSession } from '../services/share-v2/telegram-read-cache.service';
import { runTelegramQueued } from '../services/share-v2/telegram-request-queue.service';
import { upsertPointerHealth } from '../services/share-v2/telegram-pointer-health.service';

// ─── Disk Cache Config ───────────────────────────────────────────────────────

const STREAM_CACHE_DIR = path.join(os.tmpdir(), 'axya_streams');
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

// Ensure cache dir exists
try { fs.mkdirSync(STREAM_CACHE_DIR, { recursive: true }); } catch { }

// ─── FIX C2: Ownership cache — avoids DB query on every 2s status poll ──────

interface OwnershipEntry {
    fileSize: number;
    validUntil: number;
}
/**
 * Key = `${userId}:${fileId}`, value = { fileSize, validUntil }.
 * Cache misses always re-query the DB (ownership can change if file is trashed).
 */
const ownershipCache = new Map<string, OwnershipEntry>();

async function getFileOwnership(
    fileId: string,
    userId: string,
): Promise<{ fileSize: number; telegram_message_id: string; telegram_chat_id: string; mime_type: string; file_name: string } | null> {
    const cacheKey = `${userId}:${fileId}`;
    const now = Date.now();

    // Check ownership cache (only fileSize cached — full row needed only for stream endpoint)
    const cached = ownershipCache.get(cacheKey);
    if (cached && cached.validUntil > now) {
        // Ownership confirmed — fall through to full DB query (but for status endpoint we skip it)
    }

    const result = await pool.query(
        `SELECT telegram_message_id, telegram_chat_id, mime_type, file_name, file_size
         FROM files WHERE id = $1 AND user_id = $2 AND is_trashed = false`,
        [fileId, userId]
    );

    if (result.rows.length === 0) {
        ownershipCache.delete(cacheKey); // Clear stale cache on 404
        return null;
    }

    const row = result.rows[0];
    ownershipCache.set(cacheKey, {
        fileSize: parseInt(row.file_size, 10) || 0,
        validUntil: now + 60_000, // 60s TTL
    });

    return row;
}

async function checkOwnershipCached(fileId: string, userId: string): Promise<number | null> {
    const cacheKey = `${userId}:${fileId}`;
    const now = Date.now();

    const cached = ownershipCache.get(cacheKey);
    if (cached && cached.validUntil > now) {
        return cached.fileSize; // Cache hit — skip DB
    }

    const result = await pool.query(
        `SELECT file_size FROM files WHERE id = $1 AND user_id = $2 AND is_trashed = false`,
        [fileId, userId]
    );

    if (result.rows.length === 0) {
        ownershipCache.delete(cacheKey);
        return null;
    }

    const fileSize = parseInt(result.rows[0].file_size, 10) || 0;
    ownershipCache.set(cacheKey, { fileSize, validUntil: now + 60_000 });
    return fileSize;
}

// Prune expired ownership cache entries every 5 minutes
setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of ownershipCache) {
        if (entry.validUntil <= now) ownershipCache.delete(key);
    }
}, 5 * 60 * 1000);

// ─── Download Progress Tracking ──────────────────────────────────────────────

interface DownloadProgress {
    totalSize: number;
    downloadedBytes: number;
    complete: boolean;
    error?: string;
}

const downloadProgress = new Map<string, DownloadProgress>();

/**
 * Map of fileId → Promise<string>.
 * When a download is in-flight, subsequent requests wait on the same Promise.
 */
const downloadLocks = new Map<string, Promise<string>>();

// ─── Cache Helpers ───────────────────────────────────────────────────────────

function getCachePath(fileId: string): string {
    return path.join(STREAM_CACHE_DIR, `${fileId}.cache`);
}

function getPartialPath(fileId: string): string {
    return path.join(STREAM_CACHE_DIR, `${fileId}.partial`);
}

function isCacheComplete(cachePath: string): boolean {
    try {
        const stat = fs.statSync(cachePath);
        return stat.size > 0 && (Date.now() - stat.mtimeMs) < CACHE_TTL_MS;
    } catch {
        return false;
    }
}

// Periodic cleanup of stale cache files (every 30 minutes)
setInterval(() => {
    try {
        const files = fs.readdirSync(STREAM_CACHE_DIR);
        const now = Date.now();
        for (const file of files) {
            const filePath = path.join(STREAM_CACHE_DIR, file);
            try {
                const stat = fs.statSync(filePath);
                if (now - stat.mtimeMs > CACHE_TTL_MS) {
                    fs.unlinkSync(filePath);
                    const id = file.replace(/\.(cache|partial)$/, '');
                    downloadProgress.delete(id);
                }
            } catch { }
        }
    } catch { }
}, 30 * 60 * 1000);

// ─── Download to Cache (with progress tracking) ─────────────────────────────

async function ensureCached(
    fileId: string,
    userId: string,
    sessionString: string,
    telegramMessageId: string,
    telegramChatId: string,
    fileSize: number,
): Promise<{ path: string; isComplete: boolean }> {
    const cachePath = getCachePath(fileId);
    const partialPath = getPartialPath(fileId);

    // 1. Already fully cached? Return immediately
    if (isCacheComplete(cachePath)) {
        downloadProgress.set(fileId, {
            totalSize: fileSize || fs.statSync(cachePath).size,
            downloadedBytes: fileSize || fs.statSync(cachePath).size,
            complete: true,
        });
        return { path: cachePath, isComplete: true };
    }

    // 2. Already downloading? Return partial immediately (non-blocking)
    if (downloadLocks.has(fileId)) {
        return { path: partialPath, isComplete: false };
    }

    // 3. Start new download with progress tracking
    downloadProgress.set(fileId, {
        totalSize: fileSize || 0,
        downloadedBytes: 0,
        complete: false,
    });

    const downloadPromise = (async () => {
        try {
            const sessionHash = hashSessionForCache(sessionString);
            const client = await getDynamicClient(sessionString);
            const messageId = parseInt(telegramMessageId, 10);
            const messages = await runTelegramQueued({
                sessionHash,
                operation: 'owner.getMessages',
                priority: 'interactive',
                task: () => client.getMessages(telegramChatId, { ids: messageId }),
            });

            if (!messages || messages.length === 0) {
                await upsertPointerHealth({
                    userId,
                    fileId,
                    telegramChatId,
                    telegramMessageId: messageId,
                    status: 'missing',
                    lastErrorCode: 'telegram_message_missing',
                    lastErrorMessage: 'File no longer exists in Telegram',
                    lastSessionHash: sessionHash,
                });
                throw new Error('File no longer exists in Telegram');
            }

            rememberPreferredSession(telegramChatId, messageId, sessionHash, 'ok');

            const result = await runTelegramQueued({
                sessionHash,
                operation: 'owner.downloadMedia',
                priority: 'interactive',
                task: () => client.downloadMedia(messages[0] as any, {
                    outputFile: partialPath,
                    progressCallback: (progress: number) => {
                        const prog = downloadProgress.get(fileId);
                        if (prog) {
                            prog.downloadedBytes = Math.round(progress * prog.totalSize);
                        }
                    },
                } as any),
            });

            const diskPath = typeof result === 'string' ? result : partialPath;

            if (!fs.existsSync(diskPath) || fs.statSync(diskPath).size === 0) {
                throw new Error('Download to disk failed');
            }

            // Atomic rename: .partial → .cache
            if (diskPath !== cachePath) {
                fs.renameSync(diskPath, cachePath);
            }

            const prog = downloadProgress.get(fileId);
            if (prog) {
                prog.downloadedBytes = prog.totalSize;
                prog.complete = true;
            }
            await upsertPointerHealth({
                userId,
                fileId,
                telegramChatId,
                telegramMessageId: messageId,
                status: 'healthy',
                lastSessionHash: sessionHash,
            });

            return cachePath;
        } catch (err: any) {
            const prog = downloadProgress.get(fileId);
            if (prog) prog.error = err.message;
            try { if (fs.existsSync(partialPath)) fs.unlinkSync(partialPath); } catch { }
            await upsertPointerHealth({
                userId,
                fileId,
                telegramChatId,
                telegramMessageId: parseInt(telegramMessageId, 10),
                status: /MESSAGE|MEDIA|CHAT|CHANNEL|PEER/i.test(String(err?.message || '')) ? 'missing' : 'stale',
                lastErrorCode: /MESSAGE|MEDIA|CHAT|CHANNEL|PEER/i.test(String(err?.message || ''))
                    ? 'telegram_message_missing'
                    : 'telegram_timeout',
                lastErrorMessage: String(err?.message || 'unknown telegram read error'),
            });
            throw err;
        } finally {
            downloadLocks.delete(fileId);
        }
    })();

    downloadLocks.set(fileId, downloadPromise);
    // Return immediately, progressive streaming relies on this not blocking
    return { path: partialPath, isComplete: false };
}

// ─── Stream Status Endpoint ──────────────────────────────────────────────────

export const streamStatus = async (req: AuthRequest, res: Response) => {
    if (!req.user) return sendApiError(res, 401, 'unauthorized', 'Unauthorized', { retryable: false });

    const { fileId } = req.params;

    // FIX C2: Use ownership cache — avoids DB query on every 2s poll
    const fileSize = await checkOwnershipCached(String(fileId), req.user.id);
    if (fileSize === null) {
        return sendApiError(res, 404, 'not_found', 'File not found', { retryable: false });
    }

    const prog = downloadProgress.get(String(fileId));
    const cachePath = getCachePath(String(fileId));
    const cacheComplete = isCacheComplete(cachePath);

    if (cacheComplete) {
        const stat = fs.statSync(cachePath);
        return res.json({
            success: true,
            status: 'ready',
            totalSize: stat.size,
            downloadedBytes: stat.size,
            progress: 100,
            cached: true,
        });
    }

    if (prog) {
        const progress = prog.totalSize > 0
            ? Math.round((prog.downloadedBytes / prog.totalSize) * 100)
            : 0;
        return res.json({
            success: true,
            status: prog.error ? 'error' : prog.complete ? 'ready' : 'downloading',
            totalSize: prog.totalSize,
            downloadedBytes: prog.downloadedBytes,
            progress,
            cached: false,
            error: prog.error,
        });
    }

    return res.json({
        success: true,
        status: 'pending',
        totalSize: fileSize,
        downloadedBytes: 0,
        progress: 0,
        cached: false,
    });
};

// ─── Stream Endpoint ─────────────────────────────────────────────────────────

export const streamMedia = async (req: AuthRequest, res: Response) => {
    if (!req.user) return sendApiError(res, 401, 'unauthorized', 'Unauthorized', { retryable: false });

    const { fileId } = req.params;

    try {
        // ── 1. Validate file ownership (full row needed for stream) ─────────────
        const fileRow = await getFileOwnership(String(fileId), req.user.id);
        if (!fileRow) {
            return sendApiError(res, 404, 'not_found', 'File not found or access denied', { retryable: false });
        }

        const { telegram_message_id, telegram_chat_id, mime_type, file_name } = fileRow;
        const fileSize = parseInt((fileRow as any).file_size, 10) || 0;

        // ── 2. Ensure file is cached on disk ────────────────────────────────────
        let cacheInfo: { path: string; isComplete: boolean };
        try {
            cacheInfo = await ensureCached(
                String(fileId),
                req.user.id,
                req.user.sessionString,
                String(telegram_message_id),
                String(telegram_chat_id),
                fileSize,
            );
        } catch (e: any) {
            logger.error('backend.stream', 'cache_download_failed', {
                fileId, userId: req.user.id, message: e.message,
            });
            const mapped = mapTelegramError(e, e.message || 'Stream cache warmup failed');
            return sendApiError(res, mapped.status, mapped.code, mapped.message, { retryable: mapped.retryable });
        }

        const { path: activePath, isComplete } = cacheInfo;

        // ── 3. Get actual file size from disk ───────────────────────────────────
        const totalSize = isComplete ? fs.statSync(activePath).size : fileSize;
        const mimeType = mime_type || 'application/octet-stream';

        // ── 4. Parse Range header ───────────────────────────────────────────────
        const rangeHeader = req.headers.range;
        let start = 0;
        let end = totalSize - 1;
        let isRangeRequest = false;

        if (rangeHeader) {
            const match = rangeHeader.match(/bytes=(\d*)-(\d*)/);
            if (match) {
                start = match[1] ? parseInt(match[1], 10) : 0;
                end = match[2] ? parseInt(match[2], 10) : totalSize - 1;
                isRangeRequest = true;
            }
        }

        // ── Wait for partial file to have enough bytes (Progressive) ───────────
        let availableBytes = totalSize;
        if (!isComplete) {
            const maxWaitTime = Date.now() + 30000; // 30s timeout
            while (Date.now() < maxWaitTime) {
                const prog = downloadProgress.get(String(fileId));
                if (!prog || prog.error || prog.complete) break;

                // If we have downloaded enough past the start offset to serve a small chunk (512KB)
                if (prog.downloadedBytes > start + 512 * 1024 || prog.downloadedBytes === totalSize) {
                    break;
                }
                // If we are near the end of the file
                if (prog.downloadedBytes > start && (totalSize - start) < 512 * 1024) {
                    break;
                }
                await new Promise(r => setTimeout(r, 500));
            }

            const prog = downloadProgress.get(String(fileId));
            if (prog && prog.error) {
                throw new Error('Background download failed: ' + prog.error);
            }
            if (prog) {
                availableBytes = prog.downloadedBytes;
            }
        }

        // Limit the end offset to the bytes we physically have on disk right now
        // This causes HTTP 206 Partial Content to return strictly what's ready,
        // and mobile players will naturally loop back for the rest instantly!
        end = Math.min(end, Math.max(0, availableBytes - 1));

        if (start < 0 || end < start || start >= totalSize || availableBytes <= start) {
            res.status(416).set({ 'Content-Range': `bytes */${totalSize}` });
            return res.end();
        }

        const chunkLength = end - start + 1;

        // ── 5. Set response headers ─────────────────────────────────────────────
        const headers: Record<string, string> = {
            'Content-Type': mimeType,
            'Accept-Ranges': 'bytes',
            'Content-Length': String(chunkLength),
            'Cache-Control': 'private, max-age=3600',
            'Content-Disposition': `inline; filename="${encodeURIComponent(file_name)}"`,
        };

        if (isRangeRequest) {
            headers['Content-Range'] = `bytes ${start}-${end}/${totalSize}`;
            res.status(206).set(headers);
        } else {
            res.status(200).set(headers);
        }

        // ── 6. Stream from disk cache ───────────────────────────────────────────
        const stream = fs.createReadStream(activePath, { start, end });

        // FIX M1: Destroy read stream when client disconnects to free I/O
        req.on('close', () => stream.destroy());

        stream.on('error', (err) => {
            logger.error('backend.stream', 'read_stream_error', {
                fileId, message: err.message,
            });
            if (!res.headersSent) {
                sendApiError(res, 500, 'internal_error', 'Stream read failed', { retryable: true });
            }
        });
        stream.pipe(res);

    } catch (err: any) {
        logger.error('backend.stream', 'stream_failed', {
            fileId,
            userId: req.user.id,
            message: err.message,
            stack: err.stack,
        });
        if (!res.headersSent) {
            const mapped = mapTelegramError(err, err.message || 'Stream failed');
            sendApiError(res, mapped.status, mapped.code, mapped.message, { retryable: mapped.retryable });
        }
    }
};
