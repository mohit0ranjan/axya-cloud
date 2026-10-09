import { Response } from 'express';
import { AuthRequest } from '../middlewares/auth.middleware';
import pool from '../config/db';
import { sendApiError } from '../utils/apiError';
import { formatFileRow } from '../utils/formatters';

export const getDriveHealth = async (req: AuthRequest, res: Response) => {
    if (!req.user) return sendApiError(res, 401, 'unauthorized', 'Sign in to check your drive.');
    try {
        const result = await pool.query(`SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE h.pointer_status IN ('healthy','recovered'))::int AS healthy,
            COUNT(*) FILTER (WHERE h.pointer_status IN ('missing','stale'))::int AS attention,
            COUNT(*) FILTER (WHERE h.file_id IS NULL)::int AS unchecked,
            MIN(h.last_checked_at) AS oldest_check, MAX(h.last_checked_at) AS latest_check
            FROM files f LEFT JOIN telegram_pointer_health h ON h.file_id = f.id AND h.user_id = $1
            WHERE f.user_id = $1 AND f.is_trashed = false`, [req.user.id]);
        res.json({ success: true, health: result.rows[0] });
    } catch {
        sendApiError(res, 503, 'drive_health_unavailable', 'Could not load drive health. Please retry.', { retryable: true });
    }
};

// Exact server-verified SHA-256 + size; filenames and partial hashes are not proof.
export const getDuplicates = async (req: AuthRequest, res: Response) => {
    if (!req.user) return sendApiError(res, 401, 'unauthorized', 'Sign in to find duplicates.');
    const page = Math.max(0, Math.min(10000, Math.floor(Number(req.query.page) || 0)));
    try {
        const result = await pool.query(`WITH groups AS (
            SELECT sha256_hash, file_size, COUNT(*)::int AS copies FROM files
            WHERE user_id = $1 AND is_trashed = false AND sha256_hash ~ '^[a-f0-9]{64}$'
            GROUP BY sha256_hash, file_size HAVING COUNT(*) > 1
            ORDER BY file_size DESC, sha256_hash LIMIT 21 OFFSET $2
        ) SELECT g.*, (SELECT json_agg(t) FROM (
            SELECT f.* FROM files f WHERE f.user_id = $1 AND f.is_trashed = false
            AND f.sha256_hash = g.sha256_hash AND f.file_size = g.file_size
            ORDER BY f.created_at, f.id LIMIT 8
        ) t) AS files FROM groups g ORDER BY g.file_size DESC, g.sha256_hash`, [req.user.id, page * 20]);
        res.json({ success: true, page, hasMore: result.rows.length > 20,
            groups: result.rows.slice(0, 20).map(row => ({
                hash: row.sha256_hash, size: Number(row.file_size), copies: row.copies,
                files: (row.files || []).map(formatFileRow),
            })) });
    } catch {
        sendApiError(res, 503, 'duplicates_unavailable', 'Could not load duplicate files. Please retry.', { retryable: true });
    }
};
