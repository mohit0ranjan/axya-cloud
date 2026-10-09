import pool from '../../config/db';
import { UploadSessionRow } from './upload.types';
import { StorageUploadResult } from '../../services/storage/storage.adapter';

// The file entry and completed state are one transaction. A delivery checkpoint
// contains Telegram pointers only; account credentials never enter this JSON.
export const saveDeliveryCheckpoint = async (uploadId: string, delivery: StorageUploadResult, integrity?: StorageUploadResult['integrity']) => {
    const { providerContext: _credentials, ...pointer } = delivery;
    await pool.query(
        `UPDATE upload_sessions SET storage_delivery = $2::jsonb, telegram_progress_percent = 100, updated_at = NOW()
         WHERE upload_id = $1`, [uploadId, JSON.stringify({...pointer, integrity})]
    );
};

export const commitUploadFile = async (session: UploadSessionRow, delivery: StorageUploadResult,
    hashes: { sha256: string; md5: string; partial: string }, chunks: number[], blurhash: string | null, sourceFileId?: string) => {
    const db = await pool.connect();
    try {
        await db.query('BEGIN');
        if (sourceFileId) {
            const source = await db.query('SELECT id FROM files WHERE id = $1 AND user_id = $2 AND is_trashed = false FOR UPDATE', [sourceFileId, session.user_id]);
            if (!source.rows.length) throw new Error('Deduplication source changed. Retry delivery.');
        }
        const locked = await db.query('SELECT status, file_id, worker_lease_token FROM upload_sessions WHERE upload_id = $1 FOR UPDATE', [session.upload_id]);
        const row = locked.rows[0];
        if (!row || row.status === 'cancelled') { await db.query('ROLLBACK'); return null; }
        if (session.worker_lease_token && row.worker_lease_token !== session.worker_lease_token) throw new Error('UPLOAD_WORKER_LEASE_LOST');
        if (row.status === 'completed') {
            const existing = await db.query('SELECT * FROM files WHERE id = $1', [row.file_id]);
            await db.query('COMMIT'); return existing.rows[0];
        }
        const meta = delivery.nativeMeta;
        const inserted = await db.query(
            `INSERT INTO files (user_id, folder_id, file_name, file_size, telegram_file_id, telegram_message_id, telegram_chat_id, mime_type, sha256_hash, md5_hash, partial_sha256, blurhash, tg_media_meta, tg_duration_sec, tg_width, tg_height, tg_caption, tg_source_tag)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14,$15,$16,$17,$18) RETURNING *`,
            [session.user_id, session.folder_id, session.file_name, Number(session.total_bytes), delivery.providerFileId,
             Number(delivery.providerMessageId), delivery.storageChatId, session.mime_type, hashes.sha256, hashes.md5,
             hashes.partial, blurhash, JSON.stringify(meta.mediaMeta || {}), meta.durationSec, meta.width, meta.height, meta.caption, session.source_tag]
        );
        const file = inserted.rows[0];
        if (!file) throw new Error('Upload metadata insert returned no file');
        await db.query(
            `UPDATE upload_sessions SET status = 'completed', file_id = $2, file_sha256 = $3, file_md5 = $4,
             telegram_progress_percent = 100, received_bytes = total_bytes, uploaded_chunks = $5::jsonb,
             error_code = NULL, error_message = NULL, retryable = false, finalizer_retry_at = NULL,
             updated_at = NOW(), completed_at = NOW() WHERE upload_id = $1`,
            [session.upload_id, file.id, hashes.sha256, hashes.md5, JSON.stringify(chunks)]
        );
        await db.query('COMMIT'); return file;
    } catch (error) { await db.query('ROLLBACK'); throw error; }
    finally { db.release(); }
};
