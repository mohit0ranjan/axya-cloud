import pool from '../../config/db';
import { ShareEventType } from '../../models/share-v2.model';

export const logShareV2Event = async (params: {
    shareId: string;
    eventType: ShareEventType;
    itemId?: string | null;
    statusCode?: number | null;
    errorCode?: string | null;
    meta?: Record<string, unknown>;
}) => {
    const { shareId, eventType, itemId = null, statusCode = null, errorCode = null, meta = {} } = params;
    try {
        await pool.query(
            `INSERT INTO share_events_v2 (share_id, event_type, item_id, status_code, error_code, meta)
             VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
            [shareId, eventType, itemId, statusCode, errorCode, JSON.stringify(meta)]
        );
    } catch {
        // best effort; do not block API responses.
    }
};
