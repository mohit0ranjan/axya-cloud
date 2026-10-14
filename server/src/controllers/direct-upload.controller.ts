import { Request, Response } from 'express';
import { z } from 'zod';
import pool from '../config/db';
import { getDynamicClient } from '../services/telegram.service';
import { formatFileRow, extractTelegramNativeMeta } from '../utils/formatters';
import { cacheDelByPrefix } from '../services/cache.service';
import { MAX_FILE_SIZE_BYTES } from './upload/upload.types';
import { sanitizeUploadFileName } from './upload/upload.helpers';
import { sendApiError } from '../utils/apiError';

const input = z.object({ clientKey: z.string().min(1).max(180).regex(/^[a-zA-Z0-9_-]+$/), name: z.string().min(1).max(512),
    size: z.number().int().positive().max(MAX_FILE_SIZE_BYTES), mime: z.string().min(1).max(256),
    folderId: z.string().uuid().nullable().optional() });
export const nativeUploadConfig = async (req: any, res: Response) => {
    const client = await getDynamicClient(req.user!.sessionString);
    const me = await client.getMe();
    res.json({ success: true, apiId: Number(process.env.TELEGRAM_API_ID), apiHash: process.env.TELEGRAM_API_HASH,
        telegramUserId: me.id.toString(), phone: req.user!.phone });
};
export const initDirectUpload = async (req: any, res: Response) => {
    const parsed = input.safeParse(req.body);
    if (!parsed.success) return sendApiError(res, 400, 'invalid_direct_upload', 'Invalid upload details');
    const body = parsed.data, owner = req.user!.id;
    if (body.folderId) {
        const folder = await pool.query('SELECT id FROM folders WHERE id=$1 AND user_id=$2 AND is_trashed=false', [body.folderId, owner]);
        if (!folder.rowCount) return sendApiError(res, 404, 'folder_missing', 'Folder unavailable');
    }
    const result = await pool.query(`INSERT INTO direct_uploads(user_id,client_key,file_name,total_bytes,mime_type,folder_id)
        VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(user_id,client_key) DO UPDATE SET client_key=EXCLUDED.client_key RETURNING *`,
        [owner, body.clientKey, sanitizeUploadFileName(body.name), body.size, body.mime, body.folderId || null]);
    const row = result.rows[0];
    if (row.file_name !== sanitizeUploadFileName(body.name) || Number(row.total_bytes) !== body.size || row.folder_id !== (body.folderId || null))
        return sendApiError(res, 409, 'upload_key_conflict', 'This upload key belongs to another source');
    if (row.cancelled_at) return sendApiError(res, 409, 'upload_cancelled', 'Upload cancelled', { retryable: false });
    if (row.completed_at && !row.file_id) return sendApiError(res, 410, 'file_removed', 'This completed file was removed', { retryable: false });
    res.json({ success: true, id: row.id, marker: '#axya_direct_' + row.id.replace(/-/g, ''), completed: !!row.file_id });
};

export function verifyDirectDocument(message: any, row: any) {
    const marker = '#axya_direct_' + row.id.replace(/-/g, '');
    const name = message?.document?.attributes?.find((a: any) => a.className === 'DocumentAttributeFilename')?.fileName;
    return !!message?.document && String(message.message || '').split('\n').includes(marker)
        && Number(message.document.size) === Number(row.total_bytes) && name === row.file_name;
}

export const finishDirectUpload = async (req: any, res: Response) => {
    if (!z.string().uuid().safeParse(req.params.id).success) return sendApiError(res, 400, 'invalid_upload', 'Invalid upload ID');
    const owner = req.user!.id;
    const result = await pool.query('SELECT * FROM direct_uploads WHERE id=$1 AND user_id=$2', [req.params.id, owner]);
    const row = result.rows[0];
    if (!row) return sendApiError(res, 404, 'upload_missing', 'Upload not found');
    if (row.cancelled_at) return sendApiError(res, 409, 'upload_cancelled', 'Upload cancelled', { retryable: false });
    if (row.completed_at && !row.file_id) return sendApiError(res, 410, 'file_removed', 'This completed file was removed', { retryable: false });
    if (row.file_id) {
        const existing = await pool.query('SELECT * FROM files WHERE id=$1 AND user_id=$2', [row.file_id, owner]);
        return res.json({ success: true, file: formatFileRow(existing.rows[0]) });
    }
    // Never trust a client-supplied file ID, account ID, hash or completion flag.
    const client = await getDynamicClient(req.user!.sessionString);
    const marker = '#axya_direct_' + row.id.replace(/-/g, '');
    const messages = await client.getMessages('me', { search: marker, limit: 10 });
    const message = messages.find(m => verifyDirectDocument(m, row));
    if (!message) return sendApiError(res, 409, 'telegram_delivery_pending', 'Waiting for Telegram confirmation', { retryable: true });
    const meta = extractTelegramNativeMeta(message);
    const db = await pool.connect();
    try {
        await db.query('BEGIN');
        const locked = (await db.query('SELECT * FROM direct_uploads WHERE id=$1 AND user_id=$2 FOR UPDATE', [row.id, owner])).rows[0];
        if (locked.cancelled_at) { await db.query('ROLLBACK'); return sendApiError(res,409,'upload_cancelled','Upload cancelled',{retryable:false}); }
        let file;
        if (locked.file_id) file = (await db.query('SELECT * FROM files WHERE id=$1 AND user_id=$2', [locked.file_id, owner])).rows[0];
        else {
            if (row.folder_id && !(await db.query('SELECT id FROM folders WHERE id=$1 AND user_id=$2 AND is_trashed=false FOR SHARE', [row.folder_id, owner])).rowCount)
                throw new Error('Folder unavailable');
            file = (await db.query(`INSERT INTO files(user_id,folder_id,file_name,file_size,mime_type,telegram_file_id,telegram_message_id,telegram_chat_id,tg_media_meta,tg_source_tag)
                VALUES($1,$2,$3,$4,$5,$6,$7,'me',$8::jsonb,'tdlib_direct') RETURNING *`,
                [owner,row.folder_id,row.file_name,row.total_bytes,row.mime_type,message.document!.id.toString(),message.id,JSON.stringify(meta.mediaMeta || {})])).rows[0];
            await db.query('UPDATE direct_uploads SET file_id=$2, completed_at=NOW() WHERE id=$1', [row.id,file.id]);
        }
        await db.query('COMMIT'); cacheDelByPrefix(`user:${owner}:`);
        res.json({ success:true,file:formatFileRow(file) });
    } catch (error) { await db.query('ROLLBACK'); throw error; } finally { db.release(); }
};

export const cancelDirectUpload = async (req: any, res: Response) => {
    if (!z.string().uuid().safeParse(req.params.id).success) return sendApiError(res,400,'invalid_upload','Invalid upload ID');
    const db = await pool.connect();
    try {
        await db.query('BEGIN');
        const row = (await db.query('SELECT * FROM direct_uploads WHERE id=$1 AND user_id=$2 FOR UPDATE',[req.params.id,req.user.id])).rows[0];
        if (!row) { await db.query('ROLLBACK'); return sendApiError(res,404,'upload_missing','Upload not found'); }
        // Completion and cancellation serialize on the same reservation lock.
        // Preserve a confirmed file when completion already won the race.
        if (!row.completed_at) await db.query('UPDATE direct_uploads SET cancelled_at=NOW() WHERE id=$1',[row.id]);
        await db.query('COMMIT'); res.json({success:true,completed:!!row.completed_at});
    } catch(error) {await db.query('ROLLBACK');throw error;} finally {db.release();}
};
