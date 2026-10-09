import fs from 'fs';
import path from 'path';
import os from 'os';
import pool from '../../config/db';
import { logger } from '../../utils/logger';
import { isUploadFinalizerTracked } from '../../services/upload-job-queue.service';
import { sanitizeUploadFileName } from './upload.helpers';
import {
    UPLOAD_TMP_ROOT,
    UPLOAD_MAINTENANCE_INTERVAL_MS,
    TERMINAL_TEMP_RETENTION_MS,
    ORPHAN_TEMP_RETENTION_MS,
    activeFinalizers,
    getMaintenanceTimer,
    setMaintenanceTimer,
} from './upload.types';
import { recoverActiveFinalizers } from './upload.finalizer';
import { promoteQueuedSessionsIfCapacity } from './upload.queue';
const isUploadIdDirectory = (name: string) => /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(name);

export const getUploadStagingReadiness = (): { ready: boolean; reason: string } => {
    if (process.env.NODE_ENV === 'production' && !path.isAbsolute(String(process.env.UPLOAD_STORAGE_DIR || ''))) {
        return { ready: false, reason: 'UPLOAD_STORAGE_DIR must be an absolute persistent mount in production' };
    }
    const tempRelative = path.relative(os.tmpdir(), UPLOAD_TMP_ROOT);
    if (process.env.NODE_ENV === 'production' &&
        (tempRelative === '' || (!tempRelative.startsWith('..') && !path.isAbsolute(tempRelative)))) {
        return { ready: false, reason: 'UPLOAD_STORAGE_DIR cannot use the operating system temporary directory' };
    }
    try {
        fs.mkdirSync(UPLOAD_TMP_ROOT, { recursive: true });
        fs.accessSync(UPLOAD_TMP_ROOT, fs.constants.R_OK | fs.constants.W_OK);
        return { ready: true, reason: 'ready' };
    } catch {
        return { ready: false, reason: 'Upload staging directory is unavailable or read-only' };
    }
};

// ─── Temp file lifecycle ────────────────────────────────────────────────────

export const ensureTempUploadFile = (uploadId: string, _fileName: string, _totalBytes: number, _preallocate = true): string => {
    const uploadDir = path.join(UPLOAD_TMP_ROOT, uploadId);
    fs.mkdirSync(uploadDir, { recursive: true });
    return uploadDir;
};

export const cleanupSessionTempFile = (tempFilePath: string) => {
    try {
        if (!tempFilePath) return;
        const coreDir = path.resolve(tempFilePath.endsWith('.assembled')
            ? tempFilePath.slice(0, -'.assembled'.length)
            : tempFilePath);
        // A DB path must name a single upload directory immediately below the
        // configured staging root. A string-prefix check also accepts siblings
        // such as /data/uploads-old, which is unsafe for recursive cleanup.
        if (path.dirname(coreDir) !== UPLOAD_TMP_ROOT || !isUploadIdDirectory(path.basename(coreDir))) return;

        // Delete the chunk directory if it exists
        if (fs.existsSync(coreDir)) {
            const stat = fs.statSync(coreDir);
            if (stat.isDirectory()) {
                fs.rmSync(coreDir, { recursive: true, force: true });
            }
        }
        
        // Delete the assembled file if it exists
        const assembledPath = coreDir + '.assembled';
        if (fs.existsSync(assembledPath)) {
            fs.unlinkSync(assembledPath);
        }
    } catch {
        // best effort cleanup
    }
};

// ─── Maintenance ────────────────────────────────────────────────────────────

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
        if (!uploadId || activeFinalizers.has(uploadId) || isUploadFinalizerTracked(uploadId)) continue;
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
         WHERE status IN ('queued', 'uploading', 'processing', 'paused')`
    );
    const protectedIds = new Set(activeRes.rows.map((r: any) => String(r.upload_id || '').trim()).filter(Boolean));

    const now = Date.now();
    const entries = fs.readdirSync(UPLOAD_TMP_ROOT, { withFileTypes: true });
    let cleaned = 0;
    for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const uploadId = String(entry.name || '').trim();
        if (!isUploadIdDirectory(uploadId)) continue;
        if (protectedIds.has(uploadId) || activeFinalizers.has(uploadId) || isUploadFinalizerTracked(uploadId)) continue;

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

const cleanupStaleUploadingSessions = async () => {
    // Abandoned admitted clients must not hold all upload slots for 12 hours.
    // Processing workers keep their timestamp fresh with the lease heartbeat.
    const res = await pool.query(
        `UPDATE upload_sessions
         SET status = 'failed',
             error_code = 'TIMEOUT',
             error_message = 'Upload timed out due to inactivity',
             retryable = true,
             updated_at = NOW()
         WHERE (status = 'uploading' AND updated_at < NOW() - INTERVAL '30 minutes')
            OR (status = 'processing' AND updated_at < NOW() - INTERVAL '12 hours'
                AND (worker_lease_until IS NULL OR worker_lease_until < NOW()))`
    );
    return res.rowCount || 0;
};

const runUploadMaintenance = async () => {
    // Quiet/disconnected clients keep their chunks but release admission slots.
    await pool.query(`UPDATE upload_sessions SET status = 'paused', updated_at = NOW(),
        error_code = 'CLIENT_DISCONNECTED', error_message = 'Connection paused. Resume to continue.', retryable = true
        WHERE status = 'queued' AND COALESCE(client_seen_at, created_at) < NOW() - INTERVAL '3 minutes'`);
    await pool.query(`UPDATE upload_sessions SET status = 'paused', updated_at = NOW(),
        error_code = 'CLIENT_DISCONNECTED', error_message = 'Connection paused. Resume to continue.', retryable = true
        WHERE status = 'uploading' AND COALESCE(client_seen_at, updated_at) < NOW() - INTERVAL '3 minutes'`);
    const staleCleaned = await cleanupStaleUploadingSessions();
    const terminalCleaned = await cleanupTerminalTempFiles();
    const orphanDirsCleaned = await cleanupOrphanTempDirectories();
    await recoverActiveFinalizers();
    await promoteQueuedSessionsIfCapacity();
    if (terminalCleaned > 0 || orphanDirsCleaned > 0 || staleCleaned > 0) {
        logger.info('backend.upload', 'maintenance_cleanup', {
            staleCleaned,
            terminalFilesCleaned: terminalCleaned,
            orphanDirsCleaned,
        });
    }
};

export const startUploadMaintenanceLoop = () => {
    if (getMaintenanceTimer()) return;

    const trigger = () => {
        void runUploadMaintenance().catch((err: any) => {
            logger.warn('backend.upload', 'maintenance_cleanup_failed', {
                message: String(err?.message || err || 'unknown'),
            });
        });
    };

    trigger();
    const timer = setInterval(trigger, UPLOAD_MAINTENANCE_INTERVAL_MS);
    timer.unref?.();
    setMaintenanceTimer(timer);
};
