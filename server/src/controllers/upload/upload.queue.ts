import pool from '../../config/db';
import { logUploadStage, toInt } from './upload.helpers';
import { getCapacitySnapshot, getAdaptiveConcurrencyLimits } from './upload.capacity';
import {
    QUEUE_PROMOTION_LOCK_KEY,
    MAX_ACTIVE_SESSION_FETCH,
} from './upload.types';

// ─── Queue promotion ────────────────────────────────────────────────────────

export const promoteQueuedSessionsIfCapacity = async (): Promise<void> => {
    const lockClient = await pool.connect();
    try {
        const lock = await lockClient.query('SELECT pg_try_advisory_lock($1)', [QUEUE_PROMOTION_LOCK_KEY]);
        if (!lock.rows[0]?.pg_try_advisory_lock) return;

        try {
            const capRes = await lockClient.query(
                `SELECT
                    COUNT(*) FILTER (WHERE status IN ('uploading', 'processing'))::int AS active_global,
                    COUNT(*) FILTER (WHERE status = 'queued')::int AS queued_global
                 FROM upload_sessions`
            );
            const activeGlobal = toInt(capRes.rows[0]?.active_global);
            const queuedGlobal = toInt(capRes.rows[0]?.queued_global);

            if (queuedGlobal === 0) return;

            const snapshot = await getCapacitySnapshot('__system__');
            const limits = getAdaptiveConcurrencyLimits(snapshot);

            if (limits.diskPauseNewUploads || limits.diskCritical) {
                logUploadStage('queue_promotion_skipped_disk', {
                    diskUsageMb: limits.diskUsageMb,
                    diskUsagePercent: limits.diskUsagePercent,
                    availableDiskMb: limits.availableDiskMb,
                });
                return;
            }

            const slotsAvailable = Math.max(0, limits.globalLimit - activeGlobal);
            if (slotsAvailable <= 0) return;

            const candidates = await lockClient.query(
                `SELECT DISTINCT ON (user_id) upload_id, user_id
                 FROM upload_sessions
                 WHERE status = 'queued'
                 ORDER BY user_id, created_at ASC
                 LIMIT $1`,
                [Math.min(slotsAvailable, MAX_ACTIVE_SESSION_FETCH)]
            );

            if (candidates.rows.length === 0) return;

            const idsToPromote = candidates.rows.map((r: { upload_id: string }) => r.upload_id);

            await lockClient.query(
                `UPDATE upload_sessions
                 SET status = 'uploading',
                     error_code = NULL,
                     error_message = NULL,
                     retryable = true,
                     updated_at = NOW()
                 WHERE upload_id = ANY($1::text[]) AND status = 'queued'`,
                [idsToPromote]
            );

            logUploadStage('queue_promoted', {
                promotedCount: idsToPromote.length,
                activeGlobal,
                queuedGlobal,
                slotsAvailable,
            });
        } finally {
            await lockClient.query('SELECT pg_advisory_unlock($1)', [QUEUE_PROMOTION_LOCK_KEY]);
        }
    } finally {
        lockClient.release();
    }
};

// ─── Queue position ─────────────────────────────────────────────────────────

export const getQueuePosition = async (uploadId: string, userId: string) => {
    const positionRes = await pool.query(
        `SELECT
            COUNT(*) FILTER (WHERE created_at <= (SELECT created_at FROM upload_sessions WHERE upload_id = $1))::int AS global_pos,
            COUNT(*) FILTER (WHERE user_id = $2 AND created_at <= (SELECT created_at FROM upload_sessions WHERE upload_id = $1))::int AS user_pos
         FROM upload_sessions
         WHERE status = 'queued'`,
        [uploadId, userId]
    );
    return {
        queuePositionGlobal: Math.max(0, toInt(positionRes.rows[0]?.global_pos)),
        queuePositionUser: Math.max(0, toInt(positionRes.rows[0]?.user_pos)),
    };
};
