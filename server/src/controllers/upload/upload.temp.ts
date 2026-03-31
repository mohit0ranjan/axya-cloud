import fs from 'fs';
import path from 'path';
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

// ─── Temp file lifecycle ────────────────────────────────────────────────────

export const ensureTempUploadFile = (uploadId: string, _fileName: string, _totalBytes: number, _preallocate = true): string => {
    const uploadDir = path.join(UPLOAD_TMP_ROOT, uploadId);
    fs.mkdirSync(uploadDir, { recursive: true });
    return uploadDir;
};

export const cleanupSessionTempFile = (tempFilePath: string) => {
    try {
        if (!tempFilePath || !tempFilePath.startsWith(UPLOAD_TMP_ROOT)) return;
        
        // Safety guard: never delete the root temp directory
        const normalizedRoot = path.normalize(UPLOAD_TMP_ROOT);
        const normalizedTarget = path.normalize(tempFilePath);
        if (normalizedTarget === normalizedRoot || normalizedTarget + path.sep === normalizedRoot) return;

        let coreDir = tempFilePath;
        if (tempFilePath.endsWith('.assembled')) {
            coreDir = tempFilePath.replace('.assembled', '');
        }

        // Delete the chunk directory if it exists
        if (fs.existsSync(coreDir) && coreDir !== normalizedRoot) {
            const stat = fs.statSync(coreDir);
            if (stat.isDirectory()) {
                fs.rmSync(coreDir, { recursive: true, force: true });
            }
        }
        
        // Delete the assembled file if it exists
        const assembledPath = coreDir + '.assembled';
        if (fs.existsSync(assembledPath) && assembledPath !== normalizedRoot) {
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
        if (!uploadId) continue;
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
    // If an upload has been stuck in 'uploading' or 'processing' for more than 12 hours, mark it failed to free capacity slots.
    const res = await pool.query(
        `UPDATE upload_sessions
         SET status = 'failed',
             error_code = 'TIMEOUT',
             error_message = 'Upload timed out due to inactivity',
             retryable = true,
             updated_at = NOW()
         WHERE status IN ('uploading', 'processing')
           AND updated_at < NOW() - INTERVAL '12 hours'`
    );
    return res.rowCount || 0;
};

const runUploadMaintenance = async () => {
    const staleCleaned = await cleanupStaleUploadingSessions();
    const terminalCleaned = await cleanupTerminalTempFiles();
    const orphanDirsCleaned = await cleanupOrphanTempDirectories();
    await recoverActiveFinalizers();
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
