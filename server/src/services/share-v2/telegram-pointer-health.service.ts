import pool from '../../config/db';

export type PointerHealthStatus = 'healthy' | 'stale' | 'missing' | 'recovered';

type UpsertPointerHealthInput = {
    userId: string;
    telegramChatId: string;
    telegramMessageId: number;
    status: PointerHealthStatus;
    fileId?: string | null;
    shareItemId?: string | null;
    lastErrorCode?: string | null;
    lastErrorMessage?: string | null;
    lastSessionHash?: string | null;
};

export const upsertPointerHealth = async (input: UpsertPointerHealthInput): Promise<void> => {
    const fileId = input.fileId || null;
    const shareItemId = input.shareItemId || null;

    if (!fileId && !shareItemId) return;

    const targetColumn = shareItemId ? 'share_item_id' : 'file_id';
    const targetValue = shareItemId || fileId;

    await pool.query(
        `INSERT INTO telegram_pointer_health (
            user_id,
            file_id,
            share_item_id,
            telegram_chat_id,
            telegram_message_id,
            pointer_status,
            failure_count,
            last_error_code,
            last_error_message,
            last_session_hash,
            last_checked_at,
            recovered_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW(),$11)
        ON CONFLICT (${targetColumn}) DO UPDATE SET
            user_id = EXCLUDED.user_id,
            telegram_chat_id = EXCLUDED.telegram_chat_id,
            telegram_message_id = EXCLUDED.telegram_message_id,
            pointer_status = EXCLUDED.pointer_status,
            failure_count = CASE
                WHEN EXCLUDED.pointer_status IN ('missing', 'stale') THEN telegram_pointer_health.failure_count + 1
                ELSE 0
            END,
            last_error_code = EXCLUDED.last_error_code,
            last_error_message = EXCLUDED.last_error_message,
            last_session_hash = EXCLUDED.last_session_hash,
            last_checked_at = NOW(),
            recovered_at = CASE
                WHEN EXCLUDED.pointer_status = 'recovered' THEN NOW()
                WHEN EXCLUDED.pointer_status = 'healthy' THEN telegram_pointer_health.recovered_at
                ELSE telegram_pointer_health.recovered_at
            END,
            updated_at = NOW()`,
        [
            input.userId,
            fileId,
            shareItemId,
            input.telegramChatId,
            input.telegramMessageId,
            input.status,
            input.status === 'missing' || input.status === 'stale' ? 1 : 0,
            input.lastErrorCode || null,
            input.lastErrorMessage || null,
            input.lastSessionHash || null,
            input.status === 'recovered' ? new Date() : null,
        ]
    );
};

export const getPointerHealthSummaryForUser = async (userId: string) => {
    const res = await pool.query(
        `SELECT
            COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE pointer_status = 'healthy')::int AS healthy,
            COUNT(*) FILTER (WHERE pointer_status = 'stale')::int AS stale,
            COUNT(*) FILTER (WHERE pointer_status = 'missing')::int AS missing,
            COUNT(*) FILTER (WHERE pointer_status = 'recovered')::int AS recovered
         FROM telegram_pointer_health
         WHERE user_id = $1`,
        [userId]
    );

    return {
        total: Number(res.rows[0]?.total || 0),
        healthy: Number(res.rows[0]?.healthy || 0),
        stale: Number(res.rows[0]?.stale || 0),
        missing: Number(res.rows[0]?.missing || 0),
        recovered: Number(res.rows[0]?.recovered || 0),
    };
};
