import { Response } from 'express';
import { AuthRequest } from '../middlewares/auth.middleware';
import pool from '../config/db';
import { getDynamicClient } from '../services/telegram.service';
import { upsertPointerHealth } from '../services/share-v2/telegram-pointer-health.service';
import { cacheDelByPrefix } from '../services/cache.service';
import { sendApiError } from '../utils/apiError';

// Reconcile tracked files only. Telegram-side removal never deletes Neon entries;
// transient network failures must not be interpreted as missing documents.
export const syncTelegramFiles = async (req: AuthRequest, res: Response) => {
    if (!req.user) return sendApiError(res, 401, 'unauthorized', 'Sign in to sync your files.');
    const limit = Math.max(1, Math.min(100, Math.floor(Number(req.body?.limit) || 20)));
    const rows = await pool.query(
        `SELECT f.id, f.telegram_chat_id, f.telegram_message_id, f.telegram_file_id, f.file_size,
                h.pointer_status FROM files f LEFT JOIN telegram_pointer_health h ON h.file_id = f.id
         WHERE f.user_id = $1 AND f.is_trashed = false
         ORDER BY h.last_checked_at ASC NULLS FIRST, f.created_at DESC LIMIT $2`, [req.user.id, limit]);
    if (!rows.rows.length) return res.json({success:true, checked:0, healthy:0, missing:0, stale:0, recovered:0});
    try {
        const client = await getDynamicClient(req.user.sessionString);
        const groups = new Map<string, any[]>();
        for (const file of rows.rows) {
            const chat = String(file.telegram_chat_id || 'me');
            groups.set(chat, [...(groups.get(chat) || []), file]);
        }
        const summary = { checked:0, healthy:0, missing:0, stale:0, recovered:0 };
        for (const [chat, files] of groups) {
            // If the chat cannot be read, leave previous health unchanged.
            const messages = await client.getMessages(chat, {ids:files.map(f=>Number(f.telegram_message_id))});
            const byId = new Map(messages.filter(Boolean).map((m:any)=>[m.id,m]));
            for (const file of files) {
                const message:any = byId.get(Number(file.telegram_message_id));
                const media = message?.document || message?.photo;
                const matches = media && String(media.id) === String(file.telegram_file_id)
                    && (!message.document || Number(message.document.size) === Number(file.file_size));
                const status = !media ? 'missing' : !matches ? 'stale'
                    : ['missing','stale'].includes(file.pointer_status) ? 'recovered' : 'healthy';
                await upsertPointerHealth({userId:req.user.id,fileId:file.id,telegramChatId:chat,
                    telegramMessageId:Number(file.telegram_message_id),status,
                    lastErrorCode: status==='missing'?'telegram_message_not_found':status==='stale'?'telegram_pointer_mismatch':null});
                summary.checked++; summary[status]++;
            }
        }
        cacheDelByPrefix(`user:${req.user.id}:`);
        return res.json({success:true,...summary});
    } catch {
        return sendApiError(res,503,'telegram_sync_unavailable','Telegram could not be checked. Your stored file entries have been kept.',{retryable:true});
    }
};
