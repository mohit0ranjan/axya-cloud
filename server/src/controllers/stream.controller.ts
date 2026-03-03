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
    sessionString: string,
    telegramMessageId: string,
    telegramChatId: string,
    fileSize: number,
): Promise<string> {
    const cachePath = getCachePath(fileId);
    const partialPath = getPartialPath(fileId);

    // 1. Already fully cached? Return immediately
    if (isCacheComplete(cachePath)) {
        downloadProgress.set(fileId, {
            totalSize: fileSize || fs.statSync(cachePath).size,
            downloadedBytes: fileSize || fs.statSync(cachePath).size,
            complete: true,
        });
        return cachePath;
    }

    // 2. Already downloading? Wait on the same promise
    if (downloadLocks.has(fileId)) {
        return downloadLocks.get(fileId)!;
    }

    // 3. Start new download with progress tracking
    downloadProgress.set(fileId, {
        totalSize: fileSize || 0,
        downloadedBytes: 0,
        complete: false,
    });

    const downloadPromise = (async () => {
        try {
            const client = await getDynamicClient(sessionString);
            const messages = await client.getMessages(telegramChatId, {
                ids: parseInt(telegramMessageId, 10),
            });

            if (!messages || messages.length === 0) {
                throw new Error('File no longer exists in Telegram');
            }

            const result = await client.downloadMedia(messages[0] as any, {
                outputFile: partialPath,
                progressCallback: (progress: number) => {
                    const prog = downloadProgress.get(fileId);
                    if (prog) {
                        prog.downloadedBytes = Math.round(progress * prog.totalSize);
                    }
                },
            } as any);

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

            return cachePath;
        } catch (err: any) {
            const prog = downloadProgress.get(fileId);
            if (prog) prog.error = err.message;
            try { if (fs.existsSync(partialPath)) fs.unlinkSync(partialPath); } catch { }
            throw err;
        } finally {
            downloadLocks.delete(fileId);
        }
    })();

    downloadLocks.set(fileId, downloadPromise);
    return downloadPromise;
}

// ─── Stream Status Endpoint ──────────────────────────────────────────────────

export const streamStatus = async (req: AuthRequest, res: Response) => {
    if (!req.user) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const { fileId } = req.params;

    // FIX C2: Use ownership cache — avoids DB query on every 2s poll
    const fileSize = await checkOwnershipCached(String(fileId), req.user.id);
    if (fileSize === null) {
        return res.status(404).json({ success: false, error: 'File not found' });
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
    if (!req.user) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const { fileId } = req.params;

    try {
        // ── 1. Validate file ownership (full row needed for stream) ─────────────
        const fileRow = await getFileOwnership(String(fileId), req.user.id);
        if (!fileRow) {
            return res.status(404).json({ success: false, error: 'File not found or access denied' });
        }

        const { telegram_message_id, telegram_chat_id, mime_type, file_name } = fileRow;
        const fileSize = parseInt((fileRow as any).file_size, 10) || 0;

        // ── 2. Ensure file is cached on disk ────────────────────────────────────
        let cachePath: string;
        try {
            cachePath = await ensureCached(
                String(fileId),
                req.user.sessionString,
                String(telegram_message_id),
                String(telegram_chat_id),
                fileSize,
            );
        } catch (e: any) {
            logger.error('backend.stream', 'cache_download_failed', {
                fileId, userId: req.user.id, message: e.message,
            });
            const status = e.message?.includes('session') || e.message?.includes('expired') ? 401 : 500;
            return res.status(status).json({ success: false, error: e.message });
        }

        // ── 3. Get actual file size from disk ───────────────────────────────────
        const stat = fs.statSync(cachePath);
        const totalSize = stat.size;
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

            if (start < 0 || end < start || start >= totalSize) {
                res.status(416).set({ 'Content-Range': `bytes */${totalSize}` });
                return res.end();
            }
            end = Math.min(end, totalSize - 1);
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
        const stream = fs.createReadStream(cachePath, { start, end });

        // FIX M1: Destroy read stream when client disconnects to free I/O
        req.on('close', () => stream.destroy());

        stream.on('error', (err) => {
            logger.error('backend.stream', 'read_stream_error', {
                fileId, message: err.message,
            });
            if (!res.headersSent) {
                res.status(500).json({ success: false, error: 'Stream read failed' });
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
            res.status(500).json({ success: false, error: err.message });
        }
    }
};
