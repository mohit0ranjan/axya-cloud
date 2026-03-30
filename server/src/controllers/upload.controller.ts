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
import { isAllowedUploadMime } from '../utils/uploadMime';
import Busboy from 'busboy';
import { Transform } from 'stream';
import { pipeline } from 'stream/promises';

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
    maxRetries = 3
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

            // Other errors: exponential backoff
            if (i < maxRetries - 1) {
                const backoff = Math.min(15_000, Math.pow(2, i + 1) * 1000);
                console.warn(`[Telegram] Retrying in ${backoff / 1000}s...`);
                await sleep(backoff);
            } else {
                throw error;
            }
        }
    }
};

// ─── Upload Semaphore: limit concurrent Telegram uploads ────────────────────
// Prevents server OOM crash under free-tier memory constraints.
// Telegram finalization runs one-at-a-time for maximum stability.
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
const telegramSemaphore = new Semaphore(1); // max 1 concurrent Telegram operation
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

type UploadLifecycleStatus = 'queued' | 'uploading' | 'processing' | 'completed' | 'cancelled' | 'failed';
type UploadProtocol = 'chunk' | 'stream';

type UploadSessionRow = {
    upload_id: string;
    user_id: string;
    file_name: string;
    mime_type: string | null;
    folder_id: string | null;
    telegram_chat_id: string;
    source_tag: string | null;
    upload_protocol: UploadProtocol | string | null;
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

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

const UPLOAD_TMP_ROOT = path.join(os.tmpdir(), 'axya_uploads');
const FIXED_CHUNK_SIZE_BYTES = 5 * 1024 * 1024;
const STREAM_FILE_UPLOAD_FIELD = 'file';
const STREAM_HIGH_WATER_MARK_BYTES = 1 * 1024 * 1024;
const STREAM_IDLE_TIMEOUT_MS = Number.parseInt(String(process.env.UPLOAD_STREAM_IDLE_TIMEOUT_MS || '60000'), 10) || 60_000;
const DISK_PAUSE_THRESHOLD_PERCENT = clamp(Number.parseFloat(String(process.env.UPLOAD_DISK_PAUSE_PERCENT || '80')), 50, 99);
const DISK_CRITICAL_THRESHOLD_PERCENT = clamp(Number.parseFloat(String(process.env.UPLOAD_DISK_CRITICAL_PERCENT || '92')), 60, 99.9);
const RESERVED_DISK_BYTES = Number.parseInt(String(process.env.UPLOAD_DISK_RESERVED_BYTES || String(150 * 1024 * 1024)), 10) || (150 * 1024 * 1024);
const SAFE_ACTIVE_UPLOADS_PER_USER = 1;
const BURST_ACTIVE_UPLOADS_PER_USER = 2;
const SAFE_ACTIVE_UPLOADS_GLOBAL = 1;
const BURST_ACTIVE_UPLOADS_GLOBAL = 2;
const MAX_ACTIVE_UPLOADS_PER_USER = BURST_ACTIVE_UPLOADS_PER_USER;
const MAX_GLOBAL_ACTIVE_UPLOADS = BURST_ACTIVE_UPLOADS_GLOBAL;
const MIN_SUPPORTED_UPLOAD_SIZE_BYTES = 400 * 1024 * 1024;
const ENV_MAX_FILE_SIZE_BYTES = Number.parseInt(String(process.env.UPLOAD_MAX_FILE_SIZE_BYTES || ''), 10);
const MAX_FILE_SIZE_BYTES = Number.isFinite(ENV_MAX_FILE_SIZE_BYTES) && ENV_MAX_FILE_SIZE_BYTES > 0
    ? Math.max(ENV_MAX_FILE_SIZE_BYTES, MIN_SUPPORTED_UPLOAD_SIZE_BYTES)
    : 1024 * 1024 * 1024;
const ENV_TMP_USAGE_SOFT_LIMIT_BYTES = Number.parseInt(String(process.env.UPLOAD_TMP_USAGE_SOFT_LIMIT_BYTES || ''), 10);
const TMP_USAGE_SOFT_LIMIT_BYTES = Number.isFinite(ENV_TMP_USAGE_SOFT_LIMIT_BYTES) && ENV_TMP_USAGE_SOFT_LIMIT_BYTES > 0
    ? ENV_TMP_USAGE_SOFT_LIMIT_BYTES
    : 900 * 1024 * 1024;
const QUEUE_PROMOTION_LOCK_KEY = 910205;
const QUEUE_POLL_MS_MIN = 2500;
const QUEUE_POLL_MS_MAX = 7000;
const PROCESSING_POLL_MS_MIN = 2000;
const PROCESSING_POLL_MS_MAX = 5500;
const CHUNK_DELAY_MS_MIN = 100;
const CHUNK_DELAY_MS_MAX = 300;
const MAX_ACTIVE_SESSION_FETCH = 250;
const FINALIZER_PROGRESS_UPDATE_THROTTLE_MS = 800;
const UPLOAD_MAINTENANCE_INTERVAL_MS = Number.parseInt(String(process.env.UPLOAD_MAINTENANCE_INTERVAL_MS || String(15 * 60 * 1000)), 10) || (15 * 60 * 1000);
const TERMINAL_TEMP_RETENTION_MS = Number.parseInt(String(process.env.UPLOAD_TERMINAL_TEMP_RETENTION_MS || String(6 * 60 * 60 * 1000)), 10) || (6 * 60 * 60 * 1000);
const ORPHAN_TEMP_RETENTION_MS = Number.parseInt(String(process.env.UPLOAD_ORPHAN_TEMP_RETENTION_MS || String(6 * 60 * 60 * 1000)), 10) || (6 * 60 * 60 * 1000);

const activeFinalizers = new Map<string, Promise<void>>();
let uploadMaintenanceTimer: ReturnType<typeof setInterval> | null = null;
let tmpUsageCacheBytes = 0;
let tmpUsageCacheAt = 0;

const sanitizeUploadFileName = (value: string) =>
    String(value || '')
        .replace(/[\\/]/g, '_')
        .replace(/\s+/g, ' ')
        .trim() || 'upload.bin';


const toUploadProtocol = (value: unknown): UploadProtocol => {
    const mode = String(value || '').trim().toLowerCase();
    return mode === 'stream' ? 'stream' : 'chunk';
};

const sumDirBytes = (targetPath: string): number => {
    let total = 0;
    try {
        const entries = fs.readdirSync(targetPath, { withFileTypes: true });
        for (const entry of entries) {
            const entryPath = path.join(targetPath, entry.name);
            if (entry.isDirectory()) {
                total += sumDirBytes(entryPath);
            } else if (entry.isFile()) {
                total += fs.statSync(entryPath).size;
            }
        }
    } catch {
        return total;
    }
    return total;
};

const getUploadTmpUsageBytes = () => {
    const now = Date.now();
    if (now - tmpUsageCacheAt < 10_000) return tmpUsageCacheBytes;
    tmpUsageCacheAt = now;
    tmpUsageCacheBytes = sumDirBytes(UPLOAD_TMP_ROOT);
    return tmpUsageCacheBytes;
};

type DiskUsageSnapshot = {
    totalBytes: number;
    availableBytes: number;
    usedPercent: number;
    source: 'statfs' | 'estimate';
};

const getDiskUsageSnapshot = (): DiskUsageSnapshot => {
    try {
        fs.mkdirSync(UPLOAD_TMP_ROOT, { recursive: true });
        const statfsSync = (fs as any).statfsSync as undefined | ((target: string) => any);
        if (typeof statfsSync === 'function') {
            const stat = statfsSync(UPLOAD_TMP_ROOT);
            const blockSize = Math.max(1, Number(stat?.bsize || 0));
            const totalBlocks = Math.max(0, Number(stat?.blocks || 0));
            const availableBlocks = Math.max(0, Number(stat?.bavail || 0));
            const totalBytes = totalBlocks * blockSize;
            const availableBytes = Math.min(totalBytes, availableBlocks * blockSize);
            const usedPercent = totalBytes > 0
                ? Math.max(0, Math.min(100, ((totalBytes - availableBytes) / totalBytes) * 100))
                : 0;
            return {
                totalBytes,
                availableBytes,
                usedPercent,
                source: 'statfs',
            };
        }
    } catch {
        // fall through to estimate mode
    }

    const usedBytes = getUploadTmpUsageBytes();
    const syntheticTotalBytes = Math.max(TMP_USAGE_SOFT_LIMIT_BYTES, usedBytes + 1);
    const availableBytes = Math.max(0, syntheticTotalBytes - usedBytes);
    return {
        totalBytes: syntheticTotalBytes,
        availableBytes,
        usedPercent: (usedBytes / syntheticTotalBytes) * 100,
        source: 'estimate',
    };
};

const getQueuePollMs = (activeGlobal: number, queueDepth: number) => {
    const pressure = clamp((activeGlobal / MAX_GLOBAL_ACTIVE_UPLOADS) + (queueDepth / 30), 0, 1);
    return Math.round(QUEUE_POLL_MS_MIN + ((QUEUE_POLL_MS_MAX - QUEUE_POLL_MS_MIN) * pressure));
};

const getProcessingPollMs = (activeGlobal: number, queueDepth: number) => {
    const pressure = clamp((activeGlobal / MAX_GLOBAL_ACTIVE_UPLOADS) + (queueDepth / 40), 0, 1);
    return Math.round(PROCESSING_POLL_MS_MIN + ((PROCESSING_POLL_MS_MAX - PROCESSING_POLL_MS_MIN) * pressure));
};

const getRecommendedChunkDelayMs = (activeGlobal: number, queueDepth: number) => {
    const pressure = clamp((activeGlobal / MAX_GLOBAL_ACTIVE_UPLOADS) + (queueDepth / 25), 0, 1);
    return Math.round(CHUNK_DELAY_MS_MIN + ((CHUNK_DELAY_MS_MAX - CHUNK_DELAY_MS_MIN) * pressure));
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

const ensureTempUploadFile = (uploadId: string, fileName: string, totalBytes: number, preallocate = true): string => {
    const safeName = sanitizeUploadFileName(fileName);
    const uploadDir = path.join(UPLOAD_TMP_ROOT, uploadId);
    const filePath = path.join(uploadDir, safeName);
    fs.mkdirSync(uploadDir, { recursive: true });
    const fd = fs.openSync(filePath, 'w');
    try {
        if (preallocate) {
            fs.ftruncateSync(fd, totalBytes);
        }
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

const cleanupTerminalTempFiles = async () => {
    const staleRows = await pool.query(
        `SELECT upload_id, temp_file_path
         FROM upload_sessions
         WHERE status IN ('completed', 'failed', 'cancelled')
           AND updated_at < NOW() - ($1::bigint * INTERVAL '1 millisecond')
         ORDER BY updated_at ASC
         LIMIT 500`,
        [TERMINAL_TEMP_RETENTION_MS]
    );

    let cleaned = 0;
    for (const row of staleRows.rows) {
        const uploadId = String(row.upload_id || '').trim();
        if (!uploadId || activeFinalizers.has(uploadId)) continue;
        cleanupSessionTempFile(String(row.temp_file_path || ''));
        cleaned += 1;
    }
    return cleaned;
};

const cleanupOrphanTempDirectories = async () => {
    fs.mkdirSync(UPLOAD_TMP_ROOT, { recursive: true });

    const activeRes = await pool.query(
        `SELECT upload_id
         FROM upload_sessions
         WHERE status IN ('queued', 'uploading', 'processing')`
    );
    const protectedIds = new Set(activeRes.rows.map((r) => String(r.upload_id || '').trim()).filter(Boolean));

    const now = Date.now();
    const entries = fs.readdirSync(UPLOAD_TMP_ROOT, { withFileTypes: true });
    let cleaned = 0;
    for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const uploadId = String(entry.name || '').trim();
        if (!uploadId) continue;
        if (protectedIds.has(uploadId) || activeFinalizers.has(uploadId)) continue;

        const fullPath = path.join(UPLOAD_TMP_ROOT, uploadId);
        let ageMs = Number.POSITIVE_INFINITY;
        try {
            const stat = fs.statSync(fullPath);
            ageMs = now - stat.mtimeMs;
        } catch {
            ageMs = Number.POSITIVE_INFINITY;
        }

        if (ageMs < ORPHAN_TEMP_RETENTION_MS) continue;
        try {
            fs.rmSync(fullPath, { recursive: true, force: true });
            cleaned += 1;
        } catch {
            // best effort
        }
    }
    return cleaned;
};

const runUploadMaintenance = async () => {
    const terminalCleaned = await cleanupTerminalTempFiles();
    const orphanDirsCleaned = await cleanupOrphanTempDirectories();
    if (terminalCleaned > 0 || orphanDirsCleaned > 0) {
        logger.info('backend.upload', 'maintenance_cleanup', {
            terminalFilesCleaned: terminalCleaned,
            orphanDirsCleaned,
        });
    }
};

export const startUploadMaintenanceLoop = () => {
    if (uploadMaintenanceTimer) return;

    const trigger = () => {
        void runUploadMaintenance().catch((err: any) => {
            logger.warn('backend.upload', 'maintenance_cleanup_failed', {
                message: String(err?.message || err || 'unknown'),
            });
        });
    };

    trigger();
    uploadMaintenanceTimer = setInterval(trigger, UPLOAD_MAINTENANCE_INTERVAL_MS);
    uploadMaintenanceTimer.unref?.();
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

type CapacitySnapshot = {
    activeGlobal: number;
    activeForUser: number;
    queuedGlobal: number;
    queuedForUser: number;
};

type AdaptiveLimits = {
    perUserLimit: number;
    globalLimit: number;
    lowLoad: boolean;
    diskPressure: 'normal' | 'high';
    diskUsageMb: number;
    diskUsagePercent: number;
    diskPauseNewUploads: boolean;
    diskCritical: boolean;
    availableDiskMb: number;
    rssMb: number;
};

const getCapacitySnapshot = async (userId: string): Promise<CapacitySnapshot> => {
    const result = await pool.query(
        `SELECT
            COUNT(*) FILTER (WHERE status IN ('uploading', 'processing'))::int AS active_global,
            COUNT(*) FILTER (WHERE status = 'queued')::int AS queued_global,
            COUNT(*) FILTER (WHERE user_id = $1 AND status IN ('uploading', 'processing'))::int AS active_user,
            COUNT(*) FILTER (WHERE user_id = $1 AND status = 'queued')::int AS queued_user
         FROM upload_sessions`,
        [userId]
    );

    const row = result.rows[0] || {};
    return {
        activeGlobal: toInt(row.active_global),
        activeForUser: toInt(row.active_user),
        queuedGlobal: toInt(row.queued_global),
        queuedForUser: toInt(row.queued_user),
    };
};

const getQueuePosition = async (uploadId: string, userId: string) => {
    const result = await pool.query(
        `SELECT
            (SELECT COUNT(*)::int
             FROM upload_sessions q
             WHERE q.status = 'queued'
               AND (q.created_at < s.created_at OR (q.created_at = s.created_at AND q.upload_id <= s.upload_id))) AS queue_position_global,
            (SELECT COUNT(*)::int
             FROM upload_sessions q
             WHERE q.user_id = $2
               AND q.status = 'queued'
               AND (q.created_at < s.created_at OR (q.created_at = s.created_at AND q.upload_id <= s.upload_id))) AS queue_position_user
         FROM upload_sessions s
         WHERE s.upload_id = $1
         LIMIT 1`,
        [uploadId, userId]
    );
    const row = result.rows[0] || {};
    return {
        queuePositionGlobal: Math.max(0, toInt(row.queue_position_global)),
        queuePositionUser: Math.max(0, toInt(row.queue_position_user)),
    };
};

const getAdaptiveConcurrencyLimits = (capacity: CapacitySnapshot): AdaptiveLimits => {
    const memory = process.memoryUsage();
    const heapRatio = memory.heapTotal > 0 ? (memory.heapUsed / memory.heapTotal) : 0;
    const rssMb = Math.round(memory.rss / (1024 * 1024));
    const disk = getDiskUsageSnapshot();
    const diskUsageMb = Math.round((disk.totalBytes - disk.availableBytes) / (1024 * 1024));
    const diskUsagePercent = Number(disk.usedPercent.toFixed(2));
    const availableDiskMb = Math.round(disk.availableBytes / (1024 * 1024));
    const diskPauseNewUploads = diskUsagePercent >= DISK_PAUSE_THRESHOLD_PERCENT || disk.availableBytes < RESERVED_DISK_BYTES;
    const diskCritical = diskUsagePercent >= DISK_CRITICAL_THRESHOLD_PERCENT || disk.availableBytes < Math.round(RESERVED_DISK_BYTES * 0.5);
    const diskPressure: 'normal' | 'high' = diskPauseNewUploads ? 'high' : 'normal';

    const lowLoad = heapRatio < 0.68
        && rssMb < 360
        && diskPressure === 'normal'
        && capacity.queuedGlobal === 0
        && capacity.activeGlobal <= SAFE_ACTIVE_UPLOADS_GLOBAL;

    const perUserLimit = diskPauseNewUploads
        ? 0
        : (lowLoad ? BURST_ACTIVE_UPLOADS_PER_USER : SAFE_ACTIVE_UPLOADS_PER_USER);
    const globalLimit = diskPauseNewUploads
        ? 0
        : (lowLoad ? BURST_ACTIVE_UPLOADS_GLOBAL : SAFE_ACTIVE_UPLOADS_GLOBAL);

    return {
        perUserLimit,
        globalLimit,
        lowLoad,
        diskPressure,
        diskUsageMb,
        diskUsagePercent,
        diskPauseNewUploads,
        diskCritical,
        availableDiskMb,
        rssMb,
    };
};

const buildBackpressureHints = (status: UploadLifecycleStatus | string, capacity: CapacitySnapshot) => {
    const memory = process.memoryUsage();
    const heapRatio = memory.heapTotal > 0 ? (memory.heapUsed / memory.heapTotal) : 0;
    const limits = getAdaptiveConcurrencyLimits(capacity);
    const rssMb = limits.rssMb;
    const memoryPressure = heapRatio >= 0.86 || rssMb >= 430 ? 'high'
        : heapRatio >= 0.72 || rssMb >= 340 ? 'medium'
            : 'low';

    let recommendedChunkDelayMs = getRecommendedChunkDelayMs(capacity.activeGlobal, capacity.queuedGlobal);
    let recommendedPollMs = status === 'queued'
        ? getQueuePollMs(capacity.activeGlobal, capacity.queuedGlobal)
        : status === 'processing'
            ? getProcessingPollMs(capacity.activeGlobal, capacity.queuedGlobal)
            : getQueuePollMs(Math.max(0, capacity.activeGlobal - 1), Math.max(0, capacity.queuedGlobal - 1));

    if (memoryPressure === 'high') {
        recommendedChunkDelayMs = Math.max(recommendedChunkDelayMs, 300);
        recommendedPollMs = Math.max(recommendedPollMs, 6000);
    } else if (memoryPressure === 'medium') {
        recommendedChunkDelayMs = Math.max(recommendedChunkDelayMs, 220);
        recommendedPollMs = Math.max(recommendedPollMs, 4200);
    }

    if (limits.diskPauseNewUploads) {
        recommendedChunkDelayMs = Math.max(recommendedChunkDelayMs, 320);
        recommendedPollMs = Math.max(recommendedPollMs, 7000);
    }

    const capacityLevel = capacity.activeGlobal >= limits.globalLimit
        ? 'high'
        : capacity.activeGlobal >= Math.max(1, limits.globalLimit - 1)
            ? 'medium'
            : 'low';
    const level = memoryPressure === 'high' || capacityLevel === 'high' || limits.diskPressure === 'high'
        ? 'high'
        : memoryPressure === 'medium' || capacityLevel === 'medium'
            ? 'medium'
            : 'low';

    return {
        backpressure: {
            level,
            activeGlobal: capacity.activeGlobal,
            queuedGlobal: capacity.queuedGlobal,
            memoryPressure,
            rssMb,
            diskPressure: limits.diskPressure,
            diskUsageMb: limits.diskUsageMb,
            diskUsagePercent: limits.diskUsagePercent,
            availableDiskMb: limits.availableDiskMb,
            diskPauseNewUploads: limits.diskPauseNewUploads,
            activeGlobalLimit: limits.globalLimit,
            activePerUserLimit: limits.perUserLimit,
        },
        recommendedChunkDelayMs,
        recommendedPollMs,
    };
};

const promoteQueuedSessionsIfCapacity = async () => {
    const lockRes = await pool.query('SELECT pg_try_advisory_lock($1) AS locked', [QUEUE_PROMOTION_LOCK_KEY]);
    const locked = Boolean(lockRes.rows?.[0]?.locked);
    if (!locked) return;

    try {
    const grouped = await pool.query(
        `SELECT user_id, COUNT(*)::int AS active_count
         FROM upload_sessions
         WHERE status IN ('uploading', 'processing')
         GROUP BY user_id`
    );

    const userActive = new Map<string, number>();
    for (const row of grouped.rows) {
        userActive.set(String(row.user_id), toInt(row.active_count));
    }

    const globalActive = grouped.rows.reduce((acc, row) => acc + toInt(row.active_count), 0);

    const queuedCountRes = await pool.query(
        `SELECT COUNT(*)::int AS queued_global
         FROM upload_sessions
         WHERE status = 'queued'`
    );
    const queuedGlobal = toInt(queuedCountRes.rows?.[0]?.queued_global);
    const limits = getAdaptiveConcurrencyLimits({
        activeGlobal: globalActive,
        activeForUser: 0,
        queuedGlobal,
        queuedForUser: 0,
    });

    if (globalActive >= limits.globalLimit) return;

    const queuedRes = await pool.query(
        `SELECT upload_id, user_id
         FROM upload_sessions
         WHERE status = 'queued'
         ORDER BY created_at ASC, upload_id ASC
         LIMIT 200`
    );

    let availableGlobal = limits.globalLimit - globalActive;
    for (const row of queuedRes.rows) {
        if (availableGlobal <= 0) break;
        const uploadId = String(row.upload_id || '').trim();
        const userId = String(row.user_id || '').trim();
        if (!uploadId || !userId) continue;

        const activeForUser = userActive.get(userId) || 0;
        if (activeForUser >= limits.perUserLimit) continue;

        const promoted = await pool.query(
            `UPDATE upload_sessions
             SET status = 'uploading',
                 updated_at = NOW(),
                 error_code = NULL,
                 error_message = NULL,
                 retryable = false
             WHERE upload_id = $1 AND status = 'queued'`,
            [uploadId]
        );

        if ((promoted.rowCount || 0) > 0) {
            userActive.set(userId, activeForUser + 1);
            availableGlobal -= 1;
        }
    }
    } finally {
        await pool.query('SELECT pg_advisory_unlock($1)', [QUEUE_PROMOTION_LOCK_KEY]);
    }
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
    if (session.status === 'processing') {
        return 'processing';
    }
    if (session.status === 'uploading' && toInt(session.received_bytes) >= toInt(session.total_bytes)) {
        return 'processing';
    }
    return session.status;
};

const toUploadStatusPayload = async (session: UploadSessionRow, capacityOverride?: CapacitySnapshot) => {
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

    const capacity = capacityOverride || await getCapacitySnapshot(session.user_id);
    const hints = buildBackpressureHints(session.status, capacity);
    const queuePosition = session.status === 'queued'
        ? await getQueuePosition(session.upload_id, session.user_id)
        : { queuePositionGlobal: 0, queuePositionUser: 0 };

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
        uploadMode: toUploadProtocol(session.upload_protocol),
        updatedAt: session.updated_at,
        queuePositionGlobal: queuePosition.queuePositionGlobal,
        queuePositionUser: queuePosition.queuePositionUser,
        ...hints,
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
                         AND (status IN ('queued', 'uploading', 'processing', 'failed', 'cancelled') OR updated_at > NOW() - INTERVAL '24 hours')
           ORDER BY updated_at DESC
           LIMIT $2`;

    const sessionsRes = await pool.query(query, [req.user.id, MAX_ACTIVE_SESSION_FETCH]);
    const capacity = await getCapacitySnapshot(req.user.id);
    const payload = await Promise.all(
        sessionsRes.rows.map((row) => toUploadStatusPayload(row as UploadSessionRow, capacity))
    );

    return res.json({ success: true, sessions: payload.map((item) => item) });
};

// ─── Step 1: Init Upload ────────────────────────────────────────────────────
// Checks file hash first; if duplicate exists, returns existing file immediately.
export const initUpload = async (req: AuthRequest, res: Response) => {
    if (!req.user) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const { originalname, size, mimetype, folder_id, telegram_chat_id, hash, source_tag, chunk_size_bytes, upload_mode } = req.body;

    if (!originalname || size === undefined || size === null) {
        return res.status(400).json({ success: false, error: 'Missing file info (originalname, size required)' });
    }

    const fileName = sanitizeUploadFileName(String(originalname));
    const fileSize = toInt(size);
    if (fileSize <= 0) {
        return res.status(400).json({ success: false, error: 'File size must be greater than 0 bytes' });
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

    const uploadMode = toUploadProtocol(upload_mode);

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

    if (uploadMode === 'chunk' && chunk_size_bytes !== undefined && chunk_size_bytes !== null) {
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

    const chunkSize = uploadMode === 'stream' ? fileSize : FIXED_CHUNK_SIZE_BYTES;
    const totalChunks = uploadMode === 'stream' ? 1 : Math.max(1, Math.ceil(fileSize / chunkSize));

    // Fix #8: Check storage quota BEFORE connecting to Telegram.
    // If the user is over quota, we avoid wasting time establishing a Telegram session.
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

    // (Quota check moved earlier — before resolveUploadTransport — see Fix #8 above)

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

        const canPreallocateChunkFile = uploadMode === 'chunk' && initialStatus === 'uploading' && !diskCannotFitNow;
        tempFilePath = ensureTempUploadFile(uploadId, fileName, fileSize, canPreallocateChunkFile);
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
                uploadMode,
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
            uploadMode,
            queued: initialStatus === 'queued',
        });

        return res.json({
            success: true,
            uploadId,
            duplicate: false,
            status: initialStatus,
            uploadMode,
            queued: initialStatus === 'queued',
            chunkSizeBytes: chunkSize,
            totalChunks,
            queuePositionGlobal: queuePosition.queuePositionGlobal,
            queuePositionUser: queuePosition.queuePositionUser,
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

    await promoteQueuedSessionsIfCapacity();

    let session = await getOwnedUploadSession(uploadId, req.user.id);
    if (!session) {
        return res.status(404).json({ success: false, error: 'Upload session not found' });
    }

    if (session.status === 'queued') {
        await promoteQueuedSessionsIfCapacity();
        session = await getOwnedUploadSession(uploadId, req.user.id);
        if (!session) {
            return res.status(404).json({ success: false, error: 'Upload session not found' });
        }
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
    if (session.status === 'cancelled') {
        return res.status(409).json({ success: false, error: 'Upload has been cancelled', code: 'UPLOAD_CANCELLED' });
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
        return res.status(409).json({ success: false, error: 'Upload is in failed state. Restart required.', code: 'UPLOAD_FAILED' });
    }

    if (toUploadProtocol(session.upload_protocol) === 'stream') {
        return res.status(409).json({
            success: false,
            error: 'This upload session expects stream mode.',
            code: 'UPLOAD_STREAM_ONLY',
            retryable: false,
        });
    }

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
    const chunkSize = toInt(session.chunk_size_bytes) || FIXED_CHUNK_SIZE_BYTES;
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
    const capacity = await getCapacitySnapshot(req.user.id);

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
        ...buildBackpressureHints('uploading', capacity),
    });
};

export const uploadStream = async (req: AuthRequest, res: Response) => {
    if (!req.user) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const uploadId = String(req.params.uploadId || '').trim();
    if (!uploadId) return res.status(400).json({ success: false, error: 'Missing uploadId' });

    const contentType = String(req.headers['content-type'] || '').toLowerCase();
    if (!contentType.includes('multipart/form-data')) {
        return res.status(415).json({ success: false, error: 'Expected multipart/form-data payload' });
    }

    await promoteQueuedSessionsIfCapacity();

    let session = await getOwnedUploadSession(uploadId, req.user.id);
    if (!session) {
        return res.status(404).json({ success: false, error: 'Upload session not found' });
    }

    if (toUploadProtocol(session.upload_protocol) !== 'stream') {
        return res.status(409).json({
            success: false,
            code: 'UPLOAD_CHUNK_ONLY',
            error: 'This upload session expects chunk mode.',
            retryable: false,
        });
    }

    if (session.status === 'queued') {
        await promoteQueuedSessionsIfCapacity();
        session = await getOwnedUploadSession(uploadId, req.user.id);
        if (!session) {
            return res.status(404).json({ success: false, error: 'Upload session not found' });
        }
    }

    if (session.status === 'completed') {
        const payload = await toUploadStatusPayload(session);
        return res.json(payload);
    }

    if (session.status === 'queued') {
        const capacity = await getCapacitySnapshot(req.user.id);
        const queuePosition = await getQueuePosition(uploadId, req.user.id);
        return res.status(409).json({
            success: false,
            status: 'queued',
            code: 'UPLOAD_QUEUED',
            error: 'Upload is queued. Please retry after the recommended delay.',
            retryable: true,
            queuePositionGlobal: queuePosition.queuePositionGlobal,
            queuePositionUser: queuePosition.queuePositionUser,
            ...buildBackpressureHints('queued', capacity),
        });
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

    if (session.status === 'cancelled') {
        return res.status(409).json({ success: false, error: 'Upload has been cancelled', code: 'UPLOAD_CANCELLED' });
    }

    if (session.status === 'failed') {
        return res.status(409).json({ success: false, error: 'Upload is in failed state. Restart required.', code: 'UPLOAD_FAILED' });
    }

    const expectedBytes = Math.max(0, toInt(session.total_bytes));
    if (expectedBytes <= 0) {
        return sendApiError(res, 409, 'invalid_stream_session', 'Upload session is missing expected byte size.', { retryable: false });
    }

    const expectedMime = String(session.mime_type || '').trim().toLowerCase();
    if (!isAllowedUploadMime(expectedMime)) {
        return sendApiError(res, 400, 'unsupported_mime_type', `File type '${expectedMime || 'unknown'}' is not permitted.`, { retryable: false });
    }

    const capacityBeforeStream = await getCapacitySnapshot(req.user.id);
    const limitsBeforeStream = getAdaptiveConcurrencyLimits(capacityBeforeStream);
    const diskBeforeStream = getDiskUsageSnapshot();
    const streamWouldOverflowDisk = diskBeforeStream.availableBytes > 0
        && (diskBeforeStream.availableBytes - RESERVED_DISK_BYTES) < expectedBytes;
    if (limitsBeforeStream.diskPauseNewUploads || streamWouldOverflowDisk) {
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
            error: 'Upload is queued while storage capacity is constrained.',
            retryable: true,
            queuePositionGlobal: queuePosition.queuePositionGlobal,
            queuePositionUser: queuePosition.queuePositionUser,
            ...buildBackpressureHints('queued', capacityBeforeStream),
        });
    }

    fs.mkdirSync(path.dirname(session.temp_file_path), { recursive: true });

    try {
        const streamResult = await new Promise<{ bytesWritten: number; sha256: string; fileMime: string }>((resolve, reject) => {
            const busboy = Busboy({
                headers: req.headers,
                highWaterMark: STREAM_HIGH_WATER_MARK_BYTES,
                fileHwm: STREAM_HIGH_WATER_MARK_BYTES,
                limits: {
                    files: 1,
                    fields: 20,
                    fileSize: expectedBytes,
                },
            });

            let settled = false;
            let fileSeen = false;
            let bytesWritten = 0;
            let seenMime = expectedMime;
            const hash = crypto.createHash('sha256');
            let pipePromise: Promise<void> | null = null;
            let idleTimer: ReturnType<typeof setTimeout> | null = null;
            let activeFileStream: any = null;
            let activeOutStream: fs.WriteStream | null = null;

            const clearIdleTimer = () => {
                if (idleTimer) {
                    clearTimeout(idleTimer);
                    idleTimer = null;
                }
            };

            const resetIdleTimer = () => {
                clearIdleTimer();
                idleTimer = setTimeout(() => {
                    const timeoutErr = new Error('STREAM_IDLE_TIMEOUT');
                    try { activeFileStream?.destroy(timeoutErr as any); } catch { }
                    try { activeOutStream?.destroy(timeoutErr); } catch { }
                    finish(timeoutErr);
                }, STREAM_IDLE_TIMEOUT_MS);
            };

            const finish = (err?: Error, value?: { bytesWritten: number; sha256: string; fileMime: string }) => {
                if (settled) return;
                settled = true;
                clearIdleTimer();
                if (err) {
                    reject(err);
                } else if (value) {
                    resolve(value);
                } else {
                    reject(new Error('Stream upload failed'));
                }
            };

            req.on('aborted', () => finish(new Error('UPLOAD_ABORTED')));
            req.on('error', (err: any) => finish(new Error(String(err?.message || 'request_error'))));
            busboy.on('error', (err: any) => finish(new Error(String(err?.message || 'stream_parse_failed'))));

            busboy.on('file', (fieldName, file, info) => {
                if (fileSeen) {
                    file.resume();
                    finish(new Error('Multiple files are not supported'));
                    return;
                }

                if (fieldName !== STREAM_FILE_UPLOAD_FIELD) {
                    file.resume();
                    finish(new Error(`Expected multipart field '${STREAM_FILE_UPLOAD_FIELD}'`));
                    return;
                }

                const incomingMime = String(info?.mimeType || '').trim().toLowerCase();
                if (incomingMime && incomingMime !== expectedMime) {
                    file.resume();
                    finish(new Error('MIME_TYPE_MISMATCH'));
                    return;
                }

                fileSeen = true;
                seenMime = incomingMime || expectedMime;
                file.on('limit', () => finish(new Error('STREAM_FILE_TOO_LARGE')));
                file.on('data', () => resetIdleTimer());
                activeFileStream = file as any;

                const meter = new Transform({
                    transform(chunk, _enc, callback) {
                        bytesWritten += chunk.length;
                        hash.update(chunk);
                        callback(null, chunk);
                    },
                });

                const out = fs.createWriteStream(session.temp_file_path, {
                    flags: 'w',
                    highWaterMark: STREAM_HIGH_WATER_MARK_BYTES,
                });
                activeOutStream = out;

                pipePromise = pipeline(file, meter, out);
                pipePromise.catch((err: any) => {
                    finish(new Error(String(err?.message || 'stream_pipeline_failed')));
                });
            });

            busboy.on('finish', async () => {
                if (!fileSeen) {
                    finish(new Error('No file stream found in upload payload'));
                    return;
                }

                try {
                    if (pipePromise) {
                        await pipePromise;
                    }

                    if (bytesWritten !== expectedBytes) {
                        finish(new Error(`STREAM_SIZE_MISMATCH:${bytesWritten}:${expectedBytes}`));
                        return;
                    }

                    finish(undefined, {
                        bytesWritten,
                        sha256: hash.digest('hex'),
                        fileMime: seenMime,
                    });
                } catch (err: any) {
                    finish(new Error(String(err?.message || 'stream_finish_failed')));
                }
            });

            resetIdleTimer();
            req.pipe(busboy);
        });

        await pool.query('DELETE FROM upload_session_chunks WHERE upload_id = $1', [uploadId]);
        await pool.query(
            `INSERT INTO upload_session_chunks (upload_id, chunk_index, chunk_size_bytes, chunk_hash_sha256)
             VALUES ($1, 0, $2, $3)`,
            [uploadId, streamResult.bytesWritten, streamResult.sha256]
        );

        await pool.query(
            `UPDATE upload_sessions
             SET uploaded_chunks = '[0]'::jsonb,
                 received_bytes = $2,
                 status = 'processing',
                 mime_type = $3,
                 telegram_progress_percent = GREATEST(telegram_progress_percent, 0),
                 error_code = NULL,
                 error_message = NULL,
                 retryable = false,
                 updated_at = NOW()
             WHERE upload_id = $1`,
            [uploadId, streamResult.bytesWritten, streamResult.fileMime || expectedMime]
        );

        startUploadFinalizer(uploadId, req.user.sessionString);

        const capacity = await getCapacitySnapshot(req.user.id);
        return res.json({
            success: true,
            uploadId,
            status: 'processing',
            receivedBytes: streamResult.bytesWritten,
            totalBytes: expectedBytes,
            ...buildBackpressureHints('processing', capacity),
        });
    } catch (err: any) {
        const message = String(err?.message || 'stream_upload_failed');
        const retryable = !message.includes('MIME_TYPE_MISMATCH')
            && !message.includes('STREAM_SIZE_MISMATCH')
            && !message.includes('STREAM_FILE_TOO_LARGE');

        const errorCode = message.includes('MIME_TYPE_MISMATCH')
            ? 'mime_type_mismatch'
            : message.includes('STREAM_SIZE_MISMATCH')
                ? 'stream_size_mismatch'
                : message.includes('STREAM_FILE_TOO_LARGE')
                    ? 'stream_file_too_large'
                    : message.includes('STREAM_IDLE_TIMEOUT')
                        ? 'stream_idle_timeout'
                    : message.includes('UPLOAD_ABORTED')
                        ? 'stream_aborted'
                        : 'stream_upload_failed';

        await updateSessionFailure(uploadId, errorCode, 'Stream upload failed. Please retry.', retryable);

        const httpStatus = errorCode === 'stream_file_too_large'
            ? 413
            : errorCode === 'stream_idle_timeout'
                ? 408
            : errorCode === 'stream_size_mismatch' || errorCode === 'mime_type_mismatch'
                ? 422
                : 500;

        return sendApiError(res, httpStatus, errorCode, 'Unable to receive upload stream.', { retryable });
    }
};

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
                 WHERE upload_id = $1 AND status = 'processing'`,
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

        // Fix #1: Immediately re-check session status after Telegram upload.
        // If the user cancelled during the (potentially slow) Telegram upload,
        // the message is now orphaned. We must delete it from Telegram to prevent
        // an unreferenced message that's never cleaned up.
        const latestSession = await getUploadSessionById(uploadId);
        if (!latestSession || latestSession.status === 'cancelled') {
            // Best-effort: delete the orphaned Telegram message
            try {
                const tgMsgId = uploadedMessage.id;
                if (tgMsgId) {
                    await client.deleteMessages(uploadTransport.chatId, [tgMsgId], { revoke: true });
                    logger.info('backend.upload', 'orphan_telegram_message_deleted', {
                        uploadId,
                        telegramMessageId: tgMsgId,
                        chatId: uploadTransport.chatId,
                        reason: 'cancelled_during_telegram_upload',
                    });
                }
            } catch (deleteErr: any) {
                logger.warn('backend.upload', 'orphan_telegram_message_delete_failed', {
                    uploadId,
                    telegramMessageId: uploadedMessage.id,
                    message: deleteErr?.message,
                });
            }
            cleanupSessionTempFile(session.temp_file_path);
            await promoteQueuedSessionsIfCapacity();
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
                // Fix #2: Use _300.webp to match the actual 300px resize, not 1080px
                fs.writeFileSync(path.join(thumbDir, `${fileRow.id}.webp`), finalThumbBuffer);
                fs.writeFileSync(path.join(thumbDir, `${fileRow.id}_300.webp`), finalThumbBuffer);
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
        await promoteQueuedSessionsIfCapacity();
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
        await promoteQueuedSessionsIfCapacity();
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
        return res.status(409).json({ success: false, error: 'Upload is cancelled', code: 'UPLOAD_CANCELLED' });
    }
    // Fix #4: Explicitly handle 'failed' status instead of letting it fall through
    // to chunk validation, which would return a confusing UPLOAD_INCOMPLETE error.
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

    await promoteQueuedSessionsIfCapacity();

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

    await promoteQueuedSessionsIfCapacity();

    const session = await getOwnedUploadSession(uploadId, req.user.id);
    if (!session) {
        return res.status(404).json({ success: false, error: 'Upload not found or expired' });
    }

    const payload = await toUploadStatusPayload(session);
    return res.json(payload);
};
