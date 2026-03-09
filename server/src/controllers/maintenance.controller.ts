import { Response } from 'express';
import pool from '../config/db';
import { AuthRequest } from '../middlewares/auth.middleware';
import { sendApiError } from '../utils/apiError';
import { resolveTelegramMessageForShareItem } from '../services/share-v2/telegram-read.service';
import { getTelegramQueueHealth } from '../services/share-v2/telegram-request-queue.service';
import { getReadReplicaCacheStats } from '../services/share-v2/telegram-read-cache.service';
import { getPointerHealthSummaryForUser, upsertPointerHealth } from '../services/share-v2/telegram-pointer-health.service';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const isUuid = (v: string): boolean => UUID_REGEX.test(v);

export const getTelegramHealth = async (req: AuthRequest, res: Response) => {
    if (!req.user) {
        return sendApiError(res, 401, 'unauthorized', 'Unauthorized', { retryable: false });
    }

    try {
        const [pointerSummary, queueMetricRes, segmentRes] = await Promise.all([
            getPointerHealthSummaryForUser(req.user.id),
            pool.query(
                `SELECT
                    COUNT(*)::int AS total,
                    COUNT(*) FILTER (WHERE status = 'ok')::int AS ok,
                    COUNT(*) FILTER (WHERE status = 'error')::int AS error,
                    AVG(wait_ms)::float AS avg_wait_ms,
                    AVG(run_ms)::float AS avg_run_ms
                 FROM telegram_request_queue_metrics
                 WHERE created_at > NOW() - INTERVAL '15 minutes'`
            ),
            pool.query(
                `SELECT
                    COUNT(*)::int AS total,
                    COUNT(*) FILTER (WHERE status = 'ready')::int AS ready,
                    COUNT(*) FILTER (WHERE status = 'scheduled')::int AS scheduled,
                    COUNT(*) FILTER (WHERE status = 'failed')::int AS failed
                 FROM file_segment_manifests
                 WHERE user_id = $1`,
                [req.user.id]
            ),
        ]);

        const queueMetrics = queueMetricRes.rows[0] || {};
        const segmentMetrics = segmentRes.rows[0] || {};

        return res.json({
            success: true,
            health: {
                queue: {
                    ...getTelegramQueueHealth(),
                    recentMetrics: {
                        total: Number(queueMetrics.total || 0),
                        ok: Number(queueMetrics.ok || 0),
                        error: Number(queueMetrics.error || 0),
                        avgWaitMs: Math.round(Number(queueMetrics.avg_wait_ms || 0)),
                        avgRunMs: Math.round(Number(queueMetrics.avg_run_ms || 0)),
                    },
                },
                readReplicaCache: getReadReplicaCacheStats(),
                pointerHealth: pointerSummary,
                segmentMirrors: {
                    total: Number(segmentMetrics.total || 0),
                    ready: Number(segmentMetrics.ready || 0),
                    scheduled: Number(segmentMetrics.scheduled || 0),
                    failed: Number(segmentMetrics.failed || 0),
                },
            },
        });
    } catch (err: any) {
        return sendApiError(res, 500, 'internal_error', 'Failed to read telegram health.', {
            retryable: true,
            details: process.env.NODE_ENV !== 'production' ? String(err?.message || err) : undefined,
        });
    }
};

export const healTelegramPointers = async (req: AuthRequest, res: Response) => {
    if (!req.user) {
        return sendApiError(res, 401, 'unauthorized', 'Unauthorized', { retryable: false });
    }

    const limit = Math.min(200, Math.max(1, Number.parseInt(String(req.body?.limit || req.query.limit || 50), 10) || 50));

    try {
        const candidatesRes = await pool.query(
            `SELECT
                si.id AS share_item_id,
                si.file_id,
                si.telegram_chat_id,
                si.telegram_message_id,
                si.telegram_file_id,
                sl.owner_user_id,
                tph.pointer_status
             FROM share_items_v2 si
             INNER JOIN share_links_v2 sl ON sl.id = si.share_id
             LEFT JOIN telegram_pointer_health tph ON tph.share_item_id = si.id
             WHERE sl.owner_user_id = $1
               AND (tph.share_item_id IS NULL OR tph.pointer_status IN ('missing', 'stale'))
             ORDER BY tph.last_checked_at NULLS FIRST, si.created_at DESC
             LIMIT $2`,
            [req.user.id, limit]
        );

        let healthy = 0;
        let recovered = 0;
        let unresolved = 0;

        for (const row of candidatesRes.rows) {
            const shareItemId = String(row.share_item_id || '');
            const fileId = String(row.file_id || '');
            const chatId = String(row.telegram_chat_id || '');
            const messageId = Number.parseInt(String(row.telegram_message_id || ''), 10);
            const telegramFileId = String(row.telegram_file_id || '').trim();
            if (!chatId || !Number.isFinite(messageId) || messageId <= 0) {
                unresolved += 1;
                continue;
            }

            const resolved = await resolveTelegramMessageForShareItem(req.user.id, chatId, messageId, {
                shareItemId,
                fileId,
                priority: 'background',
            });

            if (!('failure' in resolved)) {
                healthy += 1;
                continue;
            }

            if (resolved.failure.code === 'telegram_message_missing' && telegramFileId) {
                const replacement = await pool.query(
                    `SELECT telegram_chat_id, telegram_message_id
                     FROM files
                     WHERE user_id = $1
                       AND telegram_file_id = $2
                       AND is_trashed = false
                     ORDER BY created_at DESC
                     LIMIT 2`,
                    [req.user.id, telegramFileId]
                );

                if (replacement.rowCount === 1) {
                    const nextChat = String(replacement.rows[0].telegram_chat_id || '').trim();
                    const nextMessage = Number.parseInt(String(replacement.rows[0].telegram_message_id || ''), 10);
                    if (nextChat && Number.isFinite(nextMessage) && nextMessage > 0) {
                        await pool.query(
                            `UPDATE share_items_v2
                             SET telegram_chat_id = $1,
                                 telegram_message_id = $2
                             WHERE id = $3`,
                            [nextChat, nextMessage, shareItemId]
                        );

                        await upsertPointerHealth({
                            userId: req.user.id,
                            shareItemId,
                            fileId,
                            telegramChatId: nextChat,
                            telegramMessageId: nextMessage,
                            status: 'recovered',
                            lastErrorCode: null,
                            lastErrorMessage: null,
                        });

                        recovered += 1;
                        continue;
                    }
                }
            }

            unresolved += 1;
        }

        return res.json({
            success: true,
            summary: {
                scanned: candidatesRes.rowCount,
                healthy,
                recovered,
                unresolved,
            },
        });
    } catch (err: any) {
        return sendApiError(res, 500, 'internal_error', 'Failed to heal telegram pointers.', {
            retryable: true,
            details: process.env.NODE_ENV !== 'production' ? String(err?.message || err) : undefined,
        });
    }
};

export const enableFileSegmentMirror = async (req: AuthRequest, res: Response) => {
    if (!req.user) {
        return sendApiError(res, 401, 'unauthorized', 'Unauthorized', { retryable: false });
    }

    const fileId = String(req.params.id || '').trim();
    if (!isUuid(fileId)) {
        return sendApiError(res, 400, 'invalid_request', 'Invalid file id.', { retryable: false });
    }

    const chunkSizeMb = Math.min(64, Math.max(2, Number.parseInt(String(req.body?.chunk_size_mb || 8), 10) || 8));
    const chunkSizeBytes = chunkSizeMb * 1024 * 1024;

    try {
        const fileRes = await pool.query(
            `SELECT id, file_size, mime_type, telegram_chat_id
             FROM files
             WHERE id = $1
               AND user_id = $2
               AND is_trashed = false`,
            [fileId, req.user.id]
        );

        if (fileRes.rowCount === 0) {
            return sendApiError(res, 404, 'not_found', 'File not found.', { retryable: false });
        }

        const file = fileRes.rows[0];
        const fileSize = Number(file.file_size || 0);
        const mimeType = String(file.mime_type || '');

        if (!mimeType.startsWith('video/') && !mimeType.startsWith('audio/')) {
            return sendApiError(res, 400, 'invalid_request', 'Segment mirror is supported for audio/video files only.', { retryable: false });
        }

        if (fileSize < 50 * 1024 * 1024) {
            return sendApiError(res, 400, 'invalid_request', 'Segment mirror requires files >= 50MB.', { retryable: false });
        }

        const segmentCount = Math.max(1, Math.ceil(fileSize / chunkSizeBytes));
        const segments = Array.from({ length: segmentCount }).map((_, index) => ({
            index,
            offset: index * chunkSizeBytes,
            size: Math.min(chunkSizeBytes, fileSize - index * chunkSizeBytes),
            telegram_message_id: null,
        }));

        const upsert = await pool.query(
            `INSERT INTO file_segment_manifests (
                user_id,
                file_id,
                mode,
                chunk_size_bytes,
                segment_count,
                status,
                telegram_chat_id,
                segments,
                last_error
            ) VALUES ($1,$2,'segmented',$3,$4,'scheduled',$5,$6::jsonb,NULL)
            ON CONFLICT (file_id) DO UPDATE SET
                mode = 'segmented',
                chunk_size_bytes = EXCLUDED.chunk_size_bytes,
                segment_count = EXCLUDED.segment_count,
                status = 'scheduled',
                telegram_chat_id = EXCLUDED.telegram_chat_id,
                segments = EXCLUDED.segments,
                last_error = NULL,
                updated_at = NOW()
            RETURNING id, mode, chunk_size_bytes, segment_count, status, telegram_chat_id, created_at, updated_at`,
            [req.user.id, fileId, chunkSizeBytes, segmentCount, String(file.telegram_chat_id || 'me'), JSON.stringify(segments)]
        );

        return res.status(202).json({
            success: true,
            manifest: {
                ...upsert.rows[0],
                segment_mode_enabled: true,
                implementation_note: 'Manifest scheduled. Telegram chunk upload worker can process this asynchronously.',
            },
        });
    } catch (err: any) {
        return sendApiError(res, 500, 'internal_error', 'Failed to enable segment mirror.', {
            retryable: true,
            details: process.env.NODE_ENV !== 'production' ? String(err?.message || err) : undefined,
        });
    }
};
