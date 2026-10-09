import pool from '../../config/db';
import { logUploadStage, toInt } from './upload.helpers';
import { getAdaptiveConcurrencyLimits } from './upload.capacity';
import {
    QUEUE_PROMOTION_LOCK_KEY,
    MAX_ACTIVE_SESSION_FETCH,
} from './upload.types';

// ─── Queue promotion ────────────────────────────────────────────────────────

export const promoteQueuedSessionsIfCapacity = async (): Promise<void> => {
    const lockClient = await pool.connect();
    try {
        await lockClient.query('BEGIN');
        const lock = await lockClient.query('SELECT pg_try_advisory_xact_lock($1) AS acquired', [QUEUE_PROMOTION_LOCK_KEY]);
        if (!lock.rows[0]?.acquired) return;

        {
            const capRes = await lockClient.query(
                `SELECT
                    COUNT(*) FILTER (WHERE status IN ('uploading', 'processing'))::int AS active_global,
                    COUNT(*) FILTER (WHERE status = 'queued'
                        AND COALESCE(client_seen_at, created_at) > NOW() - INTERVAL '3 minutes')::int AS queued_global
                 FROM upload_sessions`
            );
            const activeGlobal = toInt(capRes.rows[0]?.active_global);
            const queuedGlobal = toInt(capRes.rows[0]?.queued_global);

            if (queuedGlobal === 0) return;

            // System admission has no owner. Never bind a sentinel string to
            // the UUID user_id column (PostgreSQL rejects '__system__').
            const snapshot = { activeGlobal, queuedGlobal, activeForUser: 0, queuedForUser: 0 };
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
                `SELECT upload_id, user_id FROM (
                     SELECT DISTINCT ON (us.user_id) us.upload_id, us.user_id, us.created_at
                     FROM upload_sessions us
                     WHERE us.status = 'queued'
                       AND COALESCE(us.client_seen_at, us.created_at) > NOW() - INTERVAL '3 minutes'
                       AND (SELECT COUNT(*) FROM upload_sessions active
                            WHERE active.user_id = us.user_id AND active.status IN ('uploading', 'processing')) < $2
                     ORDER BY us.user_id, us.created_at ASC
                 ) candidates
                 ORDER BY created_at ASC
                 LIMIT $1`,
                [Math.min(slotsAvailable, MAX_ACTIVE_SESSION_FETCH), limits.perUserLimit]
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
                 WHERE upload_id = ANY($1::uuid[]) AND status = 'queued'`,
                [idsToPromote]
            );

            logUploadStage('queue_promoted', {
                promotedCount: idsToPromote.length,
                activeGlobal,
                queuedGlobal,
                slotsAvailable,
            });
        }
    } catch (error) {
        await lockClient.query('ROLLBACK');
        throw error;
    } finally {
        await lockClient.query('COMMIT').catch(() => undefined);
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
         WHERE status = 'queued'
           AND COALESCE(client_seen_at, created_at) > NOW() - INTERVAL '3 minutes'`,
        [uploadId, userId]
    );
    return {
        queuePositionGlobal: Math.max(0, toInt(positionRes.rows[0]?.global_pos)),
        queuePositionUser: Math.max(0, toInt(positionRes.rows[0]?.user_pos)),
    };
};
