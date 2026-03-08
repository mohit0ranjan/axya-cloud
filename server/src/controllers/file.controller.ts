import { Response } from 'express';
import { AuthRequest } from '../middlewares/auth.middleware';
import { getDynamicClient } from '../services/telegram.service';
import { CustomFile } from 'telegram/client/uploads';
import pool from '../config/db';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import os from 'os';
import sharp from 'sharp';
import { logger } from '../utils/logger';
import { sendApiError } from '../utils/apiError';
import { mapTelegramError } from '../utils/telegramErrors';

// ── Allowed MIME types ─────────────────────────────────────────────────────
const ALLOWED_TYPES = [
    'image/', 'video/', 'audio/', 'application/pdf',
    'text/', 'application/zip', 'application/x-zip',
    'application/msword', 'application/vnd.openxmlformats',
    'application/vnd.ms-', 'application/json', 'application/xml',
];

const isAllowedMime = (mime: string) => ALLOWED_TYPES.some(t => mime.startsWith(t));
const clampInt = (value: unknown, fallback: number, min: number, max: number) => {
    const parsed = Number.parseInt(String(value ?? ''), 10);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(Math.max(parsed, min), max);
};

const getFileReadSessionCandidates = (ownerSessionString: string) => {
    const candidates = [
        String(process.env.TELEGRAM_STORAGE_SESSION || '').trim(),
        String(process.env.TELEGRAM_SESSION || '').trim(),
        String(ownerSessionString || '').trim(),
    ].filter(Boolean);
    return Array.from(new Set(candidates));
};

type TelegramReadClient = {
    client: any;
    isStorageSession: boolean;
};

const getTelegramReadClients = async (ownerSessionString: string): Promise<TelegramReadClient[]> => {
    const storageSession = String(process.env.TELEGRAM_STORAGE_SESSION || '').trim();
    const legacyStorageSession = String(process.env.TELEGRAM_SESSION || '').trim();
    const sessions = getFileReadSessionCandidates(ownerSessionString);
    const clients: TelegramReadClient[] = [];
    let lastErr: unknown = null;

    for (const session of sessions) {
        try {
            const client = await getDynamicClient(session);
            clients.push({
                client,
                isStorageSession: session === storageSession || session === legacyStorageSession,
            });
        } catch (err) {
            lastErr = err;
        }
    }

    if (!clients.length) {
        throw lastErr || new Error('No Telegram session available');
    }

    return clients;
};

const getChatCandidatesForClient = (chatId: string, isStorageSession: boolean): string[] => {
    const raw = String(chatId || '').trim() || 'me';
    const storageChat = String(process.env.TELEGRAM_STORAGE_CHAT_ID || '').trim();
    const out: string[] = [];

    if (raw === 'me') {
        if (isStorageSession && storageChat) out.push(storageChat);
        out.push('me');
        if (!isStorageSession && storageChat) out.push(storageChat);
    } else {
        out.push(raw);
    }

    return Array.from(new Set(out.filter(Boolean)));
};

const resolveMessageFromTelegramClients = async (
    clients: TelegramReadClient[],
    chatId: string,
    messageId: number
): Promise<{ client: any; message: any; chatIdUsed: string } | null> => {
    let lastErr: unknown = null;

    for (const entry of clients) {
        const chatCandidates = getChatCandidatesForClient(chatId, entry.isStorageSession);
        for (const chatCandidate of chatCandidates) {
            try {
                const messages = await entry.client.getMessages(chatCandidate, { ids: messageId });
                if (messages && messages.length > 0) {
                    return {
                        client: entry.client,
                        message: messages[0],
                        chatIdUsed: chatCandidate,
                    };
                }
            } catch (err) {
                lastErr = err;
            }
        }
    }

    if (lastErr) {
        throw lastErr;
    }
    return null;
};

const deleteMessageAcrossTelegramClients = async (
    clients: TelegramReadClient[],
    chatId: string,
    messageId: number
) => {
    for (const entry of clients) {
        const chatCandidates = getChatCandidatesForClient(chatId, entry.isStorageSession);
        for (const chatCandidate of chatCandidates) {
            try {
                await entry.client.deleteMessages(chatCandidate, [messageId], { revoke: true });
                return true;
            } catch {
                // best effort across sessions/chats
            }
        }
    }
    return false;
};

const logActivity = async (userId: string, action: string, fileId?: string, folderId?: string, meta?: object) => {
    try {
        await pool.query(
            'INSERT INTO activity_log (user_id, action, file_id, folder_id, meta) VALUES ($1, $2, $3, $4, $5)',
            [userId, action, fileId || null, folderId || null, JSON.stringify(meta || {})]
        );
    } catch (e) { /* Non-critical, don't block main op */ }
};

const formatFileRow = (row: any) => ({
    id: row.id,
    name: row.file_name,
    folder_id: row.folder_id,
    size: row.file_size,
    mime_type: row.mime_type,
    telegram_chat_id: row.telegram_chat_id,
    is_starred: row.is_starred,
    is_trashed: row.is_trashed,
    created_at: row.created_at,
    updated_at: row.updated_at,
    blurhash: row.blurhash || null,
    thumbnail_url: row.mime_type?.startsWith('image/') || row.mime_type?.startsWith('video/')
        ? `${process.env.SERVER_BASE_URL || ''}/api/files/${row.id}/thumbnail`
        : null,
});

// ─────────────────────────────────────────────────────────────────────────────
// UPLOAD
// ─────────────────────────────────────────────────────────────────────────────
export const uploadFile = async (req: AuthRequest, res: Response) => {

    if (!req.file || !req.user) {
        return res.status(400).json({ success: false, error: 'Request invalid or Unauthorized.' });
    }

    const { originalname, path: filePath, mimetype, size } = req.file;
    let { folder_id, telegram_chat_id } = req.body;
    folder_id = folder_id || null;
    telegram_chat_id = telegram_chat_id || 'me';

    if (!isAllowedMime(mimetype)) {
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        return res.status(400).json({ success: false, error: `File type '${mimetype}' is not permitted.` });
    }

    try {
        const client = await getDynamicClient(req.user.sessionString);

        const uploadedMessage = await client.sendFile(telegram_chat_id, {
            file: new CustomFile(originalname, size, filePath),
            caption: `[Axya] ${originalname}`,
        });

        const messageId = uploadedMessage.id;
        const fileId = uploadedMessage.document
            ? uploadedMessage.document.id.toString()
            : uploadedMessage.photo
                ? uploadedMessage.photo.id.toString()
                : '';

        const result = await pool.query(
            `INSERT INTO files (user_id, folder_id, file_name, file_size, telegram_file_id, telegram_message_id, telegram_chat_id, mime_type)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
            [req.user.id, folder_id, originalname, size, fileId, messageId, telegram_chat_id, mimetype]
        );

        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        await logActivity(req.user.id, 'upload', result.rows[0].id, folder_id || undefined, { name: originalname, size });

        res.status(201).json({ success: true, file: formatFileRow(result.rows[0]) });
    } catch (err: any) {
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        console.error("Upload error:", err);
        res.status(500).json({ success: false, error: err.message });
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// LIST FILES
// ─────────────────────────────────────────────────────────────────────────────
export const fetchFiles = async (req: AuthRequest, res: Response) => {
    if (!req.user) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const { folder_id, sort = 'created_at', order = 'DESC' } = req.query;
    const limit = clampInt(req.query.limit, 50, 1, 500);
    const page = clampInt(req.query.page, 1, 1, 100_000);
    const offset = req.query.offset !== undefined ? clampInt(req.query.offset, 0, 0, 100_000) : (page - 1) * limit;
    const validSorts = ['created_at', 'file_name', 'file_size', 'updated_at'];
    const sortCol = validSorts.includes(sort as string) ? sort : 'created_at';
    const sortOrder = order === 'ASC' ? 'ASC' : 'DESC';

    let query = `SELECT * FROM files WHERE user_id = $1 AND is_trashed = false`;
    const params: any[] = [req.user.id];

    if (folder_id === 'root' || folder_id === 'null') {
        query += ` AND folder_id IS NULL`;
    } else if (folder_id !== undefined) {
        params.push(folder_id);
        query += ` AND folder_id = $${params.length}`;
    }

    query += ` ORDER BY ${sortCol} ${sortOrder}`;
    params.push(limit);
    query += ` LIMIT $${params.length}`;
    params.push(offset);
    query += ` OFFSET $${params.length}`;

    try {
        const result = await pool.query(query, params);
        res.json({ success: true, files: result.rows.map(formatFileRow) });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// SEARCH
// ─────────────────────────────────────────────────────────────────────────────
export const searchFiles = async (req: AuthRequest, res: Response) => {
    if (!req.user) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const { q, type, folder_id } = req.query;
    // ✅ Fix 2.2: Accept limit/offset for paginated search (hardcoded LIMIT 50 removed)
    const limit = clampInt(req.query.limit, 50, 1, 200);
    const offset = clampInt(req.query.offset, 0, 0, 100_000);
    if (!q) return res.status(400).json({ success: false, error: 'Search query required.' });

    try {
        let filesQuery = `
            SELECT f.*, 'file' as result_type FROM files f
            WHERE f.user_id = $1 AND f.is_trashed = false AND f.file_name ILIKE $2
        `;
        const params: any[] = [req.user.id, `%${q}%`];

        if (folder_id) {
            params.push(folder_id);
            filesQuery += ` AND f.folder_id = $${params.length}`;
        }

        if (type) {
            params.push(type as string);
            filesQuery += ` AND f.mime_type ILIKE $${params.length}`;
        }

        params.push(limit);
        filesQuery += ` ORDER BY f.created_at DESC LIMIT $${params.length}`;
        params.push(offset);
        filesQuery += ` OFFSET $${params.length}`;

        let foldersQuery = `
            SELECT id, name, parent_id as folder_id, 0 as file_size, 'inode/directory' as mime_type, created_at, updated_at,
                   false as is_starred, false as is_trashed, null as telegram_chat_id, 'folder' as result_type
            FROM folders
            WHERE user_id = $1 AND is_trashed = false AND name ILIKE $2
        `;
        const folderParams: any[] = [req.user.id, `%${q}%`];

        if (folder_id) {
            folderParams.push(folder_id);
            foldersQuery += ` AND parent_id = $3`;
        }

        folderParams.push(limit);
        foldersQuery += ` ORDER BY name ASC LIMIT $${folderParams.length}`;

        const [filesRes, foldersRes] = await Promise.all([
            pool.query(filesQuery, params),
            pool.query(foldersQuery, folderParams)
        ]);

        const merged = [
            ...foldersRes.rows.map(r => ({ ...r, name: r.name })),
            ...filesRes.rows.map(formatFileRow).map(r => ({ ...r, result_type: 'file' }))
        ];

        res.json({
            success: true,
            results: merged,
            pagination: { limit, offset, returned: merged.length },
        });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// UPDATE FILE (rename / move)
// ─────────────────────────────────────────────────────────────────────────────
export const updateFile = async (req: AuthRequest, res: Response) => {
    if (!req.user) return res.status(401).json({ success: false, error: 'Unauthorized' });
    const { id } = req.params;
    const { folder_id, file_name } = req.body;

    const updates: string[] = [];
    const values: any[] = [];

    if (file_name !== undefined) {
        if (typeof file_name !== 'string') {
            return res.status(400).json({ success: false, error: 'file_name must be a string' });
        }
        const normalizedName = file_name.trim();
        if (!normalizedName) {
            return res.status(400).json({ success: false, error: 'file_name cannot be empty' });
        }
        if (normalizedName.length > 255) {
            return res.status(400).json({ success: false, error: 'file_name is too long (max 255 chars)' });
        }
        values.push(normalizedName);
        updates.push(`file_name = $${values.length}`);
    }
    if (folder_id !== undefined) {
        if (folder_id !== null && typeof folder_id !== 'string') {
            return res.status(400).json({ success: false, error: 'folder_id must be a string or null' });
        }
        values.push(folder_id);
        updates.push(`folder_id = $${values.length}`);
    }

    if (updates.length === 0) return res.status(400).json({ success: false, error: 'No update fields provided' });

    values.push(new Date());
    updates.push(`updated_at = $${values.length}`);

    values.push(id);
    values.push(req.user.id);

    try {
        const result = await pool.query(
            `UPDATE files SET ${updates.join(', ')} WHERE id = $${values.length - 1} AND user_id = $${values.length} AND is_trashed = false RETURNING *`,
            values
        );
        if (result.rows.length === 0) return res.status(404).json({ success: false, error: 'File not found' });
        await logActivity(req.user.id, 'rename', String(id));
        res.json({ success: true, file: formatFileRow(result.rows[0]) });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// STAR / UNSTAR
// ─────────────────────────────────────────────────────────────────────────────
export const toggleStar = async (req: AuthRequest, res: Response) => {
    if (!req.user) return res.status(401).json({ success: false, error: 'Unauthorized' });
    const { id } = req.params;

    try {
        const result = await pool.query(
            `UPDATE files SET is_starred = NOT is_starred, updated_at = NOW()
             WHERE id = $1 AND user_id = $2 RETURNING id, is_starred`,
            [id, req.user.id]
        );
        if (result.rows.length === 0) return res.status(404).json({ success: false, error: 'File not found' });
        res.json({ success: true, is_starred: result.rows[0].is_starred });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// STARRED FILES
// ─────────────────────────────────────────────────────────────────────────────
export const fetchStarred = async (req: AuthRequest, res: Response) => {
    if (!req.user) return res.status(401).json({ success: false, error: 'Unauthorized' });
    try {
        const result = await pool.query(
            `SELECT * FROM files WHERE user_id = $1 AND is_starred = true AND is_trashed = false ORDER BY updated_at DESC`,
            [req.user.id]
        );
        res.json({ success: true, files: result.rows.map(formatFileRow) });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// SOFT DELETE → TRASH
// ─────────────────────────────────────────────────────────────────────────────
export const trashFile = async (req: AuthRequest, res: Response) => {
    if (!req.user) return res.status(401).json({ success: false, error: 'Unauthorized' });
    const { id } = req.params;

    try {
        const result = await pool.query(
            `UPDATE files SET is_trashed = true, trashed_at = NOW() WHERE id = $1 AND user_id = $2 RETURNING id, file_name`,
            [id, req.user.id]
        );
        if (result.rows.length === 0) return res.status(404).json({ success: false, error: 'File not found' });
        await logActivity(req.user.id, 'trash', String(id));
        res.json({ success: true, message: 'File moved to trash.' });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// RESTORE FROM TRASH
// ─────────────────────────────────────────────────────────────────────────────
export const restoreFile = async (req: AuthRequest, res: Response) => {
    if (!req.user) return res.status(401).json({ success: false, error: 'Unauthorized' });
    const { id } = req.params;

    try {
        const result = await pool.query(
            `UPDATE files SET is_trashed = false, trashed_at = NULL WHERE id = $1 AND user_id = $2 RETURNING id`,
            [id, req.user.id]
        );
        if (result.rows.length === 0) return res.status(404).json({ success: false, error: 'File not found' });
        await logActivity(req.user.id, 'restore', String(id));
        res.json({ success: true, message: 'File restored.' });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// PERMANENT DELETE
// ─────────────────────────────────────────────────────────────────────────────
export const deleteFile = async (req: AuthRequest, res: Response) => {
    if (!req.user) return res.status(401).json({ success: false, error: 'Unauthorized' });
    const { id } = req.params;

    try {
        const fileResult = await pool.query(
            'SELECT telegram_message_id, telegram_chat_id FROM files WHERE id = $1 AND user_id = $2',
            [id, req.user.id]
        );
        if (fileResult.rows.length === 0) return res.status(404).json({ success: false, error: 'File not found' });

        const { telegram_message_id, telegram_chat_id } = fileResult.rows[0];

        try {
            const clients = await getTelegramReadClients(req.user.sessionString);
            const messageId = Number.parseInt(String(telegram_message_id || ''), 10);
            const chatId = String(telegram_chat_id || '').trim();
            if (chatId && Number.isFinite(messageId) && messageId > 0) {
                await deleteMessageAcrossTelegramClients(clients, chatId, messageId);
            }
        } catch (e) {
            console.warn('Could not delete Telegram message, removing from DB anyway:', e);
        }

        await pool.query('DELETE FROM files WHERE id = $1 AND user_id = $2', [id, req.user.id]);
        await logActivity(req.user.id, 'delete_permanent', String(id));
        res.json({ success: true, message: 'File permanently deleted.' });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// FETCH TRASH
// ─────────────────────────────────────────────────────────────────────────────
export const fetchTrash = async (req: AuthRequest, res: Response) => {
    if (!req.user) return res.status(401).json({ success: false, error: 'Unauthorized' });
    try {
        const result = await pool.query(
            `SELECT * FROM files WHERE user_id = $1 AND is_trashed = true ORDER BY trashed_at DESC`,
            [req.user.id]
        );
        res.json({ success: true, files: result.rows.map(formatFileRow) });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// EMPTY TRASH (Permanent Delete All)
// ─────────────────────────────────────────────────────────────────────────────
export const emptyTrash = async (req: AuthRequest, res: Response) => {
    if (!req.user) return res.status(401).json({ success: false, error: 'Unauthorized' });
    try {
        const result = await pool.query(
            'SELECT id, telegram_message_id, telegram_chat_id FROM files WHERE user_id = $1 AND is_trashed = true',
            [req.user.id]
        );
        const files = result.rows;
        if (files.length === 0) return res.json({ success: true, message: 'Trash is already empty.' });

        let clients: TelegramReadClient[] = [];
        try {
            clients = await getTelegramReadClients(req.user.sessionString);
        } catch (sessionErr) {
            console.warn('Could not initialize Telegram clients for emptyTrash. Proceeding DB cleanup only.', sessionErr);
        }

        // Group by chat for efficiency
        const byChat: Record<string, number[]> = {};
        files.forEach(f => {
            if (!byChat[f.telegram_chat_id]) byChat[f.telegram_chat_id] = [];
            byChat[f.telegram_chat_id].push(parseInt(f.telegram_message_id, 10));
        });

        // Delete from Telegram
        for (const chat_id in byChat) {
            for (const messageId of byChat[chat_id]) {
                if (!clients.length || !Number.isFinite(messageId) || messageId <= 0) continue;
                const deleted = await deleteMessageAcrossTelegramClients(clients, String(chat_id), messageId);
                if (!deleted) {
                    console.warn(`Could not delete message ${messageId} in chat ${chat_id}`);
                }
            }
        }

        // Delete from DB
        await pool.query('DELETE FROM files WHERE user_id = $1 AND is_trashed = true', [req.user.id]);
        await pool.query('DELETE FROM folders WHERE user_id = $1 AND is_trashed = true', [req.user.id]);

        await logActivity(req.user.id, 'empty_trash');
        res.json({ success: true, message: 'Trash cleared permanently.' });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
};


// ─────────────────────────────────────────────────────────────────────────────
// DOWNLOAD — Buffer download (fine for one-shot file saves)
// ─────────────────────────────────────────────────────────────────────────────
export const downloadFile = async (req: AuthRequest, res: Response) => {
    if (!req.user) return sendApiError(res, 401, 'unauthorized', 'Unauthorized', { retryable: false });
    const { id } = req.params;

    try {
        const fileResult = await pool.query(
            'SELECT telegram_message_id, telegram_chat_id, mime_type, file_name, file_size FROM files WHERE id = $1 AND user_id = $2 AND is_trashed = false',
            [id, req.user.id]
        );
        if (fileResult.rows.length === 0) return sendApiError(res, 404, 'not_found', 'File not found', { retryable: false });

        const { telegram_message_id, telegram_chat_id, mime_type, file_name } = fileResult.rows[0];
        const chatId = String(telegram_chat_id || '').trim();
        const messageId = Number.parseInt(String(telegram_message_id || ''), 10);

        if (!chatId || !Number.isFinite(messageId) || messageId <= 0) {
            return sendApiError(res, 409, 'invalid_request', 'File metadata is incomplete. Re-upload required.', { retryable: false });
        }

        let clients: TelegramReadClient[] = [];
        try {
            clients = await getTelegramReadClients(req.user.sessionString);
        } catch (clientErr: any) {
            logger.error('backend.download', 'telegram_session_init_failed', {
                fileId: id,
                userId: req.user.id,
                message: clientErr?.message,
            });
            const mapped = mapTelegramError(clientErr, 'Telegram session unavailable. Please reconnect Telegram.');
            return sendApiError(res, mapped.status, mapped.code, mapped.message, { retryable: mapped.retryable });
        }

        let resolved: { client: any; message: any; chatIdUsed: string } | null = null;
        try {
            resolved = await resolveMessageFromTelegramClients(clients, chatId, messageId);
        } catch (messageErr: any) {
            logger.error('backend.download', 'telegram_message_fetch_failed', {
                fileId: id,
                userId: req.user.id,
                chatId,
                messageId,
                message: messageErr?.message,
            });
            const mapped = mapTelegramError(messageErr, 'Could not load file from Telegram');
            return sendApiError(res, mapped.status, mapped.code, mapped.message, { retryable: mapped.retryable });
        }

        if (!resolved) {
            return sendApiError(res, 404, 'telegram_message_not_found', 'File no longer exists in Telegram', { retryable: false });
        }

        const mediaData = await resolved.client.downloadMedia(resolved.message as any);
        if (!mediaData) return sendApiError(res, 502, 'telegram_transient', 'Failed to retrieve file from Telegram', { retryable: true });

        const buffer = Buffer.isBuffer(mediaData)
            ? mediaData
            : typeof mediaData === 'string' && fs.existsSync(mediaData)
                ? fs.readFileSync(mediaData)
                : Buffer.from(mediaData);

        if (!buffer || buffer.length === 0) {
            return sendApiError(res, 502, 'telegram_transient', 'Downloaded file is empty', { retryable: true });
        }

        const rawName = String(file_name || 'download');
        const safeAsciiName = rawName
            .replace(/[\/\\:*?"<>|\r\n]+/g, '_')
            .replace(/\s+/g, ' ')
            .trim() || 'download';

        res.set('Content-Type', mime_type || 'application/octet-stream');
        res.set('Content-Disposition', `attachment; filename="${safeAsciiName}"; filename*=UTF-8''${encodeURIComponent(rawName)}`);
        res.set('X-Download-Source', 'telegram');
        res.set('X-File-Id', String(id));
        res.set('X-Telegram-Message-Id', String(messageId));
        res.set('X-Telegram-Chat-Id', resolved.chatIdUsed);
        res.set('Cache-Control', 'private, max-age=3600');
        res.send(buffer);
    } catch (err: any) {
        logger.error('backend.download', 'download_failed', {
            fileId: id,
            userId: req.user?.id,
            message: err?.message,
            stack: err?.stack,
        });
        if (!res.headersSent) {
            const mapped = mapTelegramError(err, 'Internal download error');
            sendApiError(res, mapped.status, mapped.code, mapped.message, { retryable: mapped.retryable });
        }
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// THUMBNAIL (MTProto) — with disk cache to avoid re-downloading per request
// ✅ Fix #16: was re-downloading full image every request. Now caches to /tmp disk.
// ─────────────────────────────────────────────────────────────────────────────
const THUMB_CACHE_DIR = path.join(os.tmpdir(), 'axya_thumbs');
const THUMB_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

// Ensure cache dir exists
try { fs.mkdirSync(THUMB_CACHE_DIR, { recursive: true }); } catch { }

export const getThumbnail = async (req: AuthRequest, res: Response) => {
    if (!req.user) return sendApiError(res, 401, 'unauthorized', 'Unauthorized', { retryable: false });
    const { id } = req.params;

    try {
        // ✅ Check disk cache first — avoid Telegram download on repeated requests
        const cacheFile = path.join(THUMB_CACHE_DIR, `${id}.webp`);
        if (fs.existsSync(cacheFile)) {
            const stat = fs.statSync(cacheFile);
            const age = Date.now() - stat.mtimeMs;
            if (age < THUMB_CACHE_TTL_MS && stat.size > 0) {
                res.setHeader('Content-Type', 'image/webp');
                res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
                res.setHeader('ETag', `W/"${id}-thumb"`);
                res.setHeader('X-Cache', 'HIT');
                return fs.createReadStream(cacheFile).pipe(res);
            }
        }

        const fileResult = await pool.query(
            'SELECT telegram_message_id, telegram_chat_id, file_name, mime_type, thumbnail_failed_count FROM files WHERE id = $1 AND user_id = $2 AND is_trashed = false',
            [id, req.user.id]
        );
        if (fileResult.rows.length === 0) return sendApiError(res, 404, 'not_found', 'File not found', { retryable: false });

        const { telegram_message_id, telegram_chat_id, file_name, mime_type, thumbnail_failed_count } = fileResult.rows[0];
        if (thumbnail_failed_count >= 3) {
            return sendApiError(res, 404, 'thumbnail_failed', 'Thumbnail generation previously failed multiple times for this file', { retryable: false });
        }
        const messageId = Number.parseInt(String(telegram_message_id || ''), 10);
        const chatId = String(telegram_chat_id || '').trim();
        if (!chatId || !Number.isFinite(messageId) || messageId <= 0) {
            return sendApiError(res, 404, 'telegram_message_not_found', 'File source is unavailable', { retryable: false });
        }
        let clients: TelegramReadClient[] = [];
        try {
            clients = await getTelegramReadClients(req.user.sessionString);
        } catch (err) {
            const mapped = mapTelegramError(err, 'Telegram session unavailable.');
            return sendApiError(res, mapped.status, mapped.code, mapped.message, { retryable: mapped.retryable });
        }
        let resolved: { client: any; message: any; chatIdUsed: string } | null = null;
        try {
            resolved = await resolveMessageFromTelegramClients(clients, chatId, messageId);
        } catch (err) {
            const mapped = mapTelegramError(err, 'Unable to resolve media in Telegram.');
            return sendApiError(res, mapped.status, mapped.code, mapped.message, { retryable: mapped.retryable });
        }
        if (!resolved) return sendApiError(res, 404, 'telegram_message_not_found', 'File no longer exists', { retryable: false });

        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
                res.setHeader('ETag', `W/"${id}-thumb"`);
        res.setHeader('X-Cache', 'MISS');

        const message = resolved.message;
        const client = resolved.client;
        let buffer: Buffer | undefined;

        // 1. First attempt: Try to find a Telegram-generated thumbnail natively (fastest)
        try {
            const media: any = message.media;
            let thumbIndex: any = 0;
            if (media && (media.photo || media.document)) {
                const thumbs = media.photo ? media.photo.sizes : media.document?.thumbs;
                if (thumbs && thumbs.length > 1) {
                    thumbIndex = thumbs.length > 3 ? 2 : thumbs.length - 1;
                }
            }
            buffer = (await client.downloadMedia(message as any, { thumb: thumbIndex })) as Buffer | undefined;
        } catch (e: any) {
            console.warn(`[Thumbnail] Native thumb fetch rejected: ${e.message}`);
        }

        // 2. Fallback: download full image and compress
        if (!buffer || buffer.length === 0) {
            buffer = (await client.downloadMedia(message as any)) as Buffer | undefined;
        }

        if (!buffer || buffer.length === 0) {
            return sendApiError(res, 404, 'telegram_message_not_found', 'Failed to extract any media data for thumbnail.', { retryable: false });
        }

        // 3. Compress with Sharp
        try {
            const optimizedBuffer = await sharp(buffer, { failOnError: false })
                .resize(1080, 1080, { fit: 'inside', withoutEnlargement: true })
                .toFormat('webp', { quality: 85, effort: 3 })
                .toBuffer();

            // ✅ Save to disk cache for next request
            fs.writeFileSync(cacheFile, optimizedBuffer);

            res.setHeader('Content-Type', 'image/webp');
            return res.send(optimizedBuffer);

        } catch (sharpError: any) {
            console.warn(`[Thumbnail] Sharp compression failed/skipped:`, sharpError.message);
            // Increment fail count
            await pool.query('UPDATE files SET thumbnail_failed_count = thumbnail_failed_count + 1 WHERE id = $1', [id]);
            res.setHeader('Content-Type', mime_type || 'application/octet-stream');
            return res.send(buffer);
        }

    } catch (err: any) {
        logger.error('backend.thumbnail', 'thumbnail_failed', {
            fileId: id,
            userId: req.user.id,
            message: err.message,
            stack: err.stack,
        });
        if (!res.headersSent) {
            const mapped = mapTelegramError(err, err.message || 'Thumbnail failed');
            sendApiError(res, mapped.status, mapped.code, mapped.message, { retryable: mapped.retryable });
        }
    }
};



// ─────────────────────────────────────────────────────────────────────────────
// STREAM MEDIA — Disk-cached streaming with HTTP Range support
// ✅ Download once from Telegram → /tmp cache → stream instantly with Range
// ✅ Cache auto-expires after 1 hour; concurrent-safe via download locks
// ─────────────────────────────────────────────────────────────────────────────

const STREAM_CACHE_DIR = path.join(os.tmpdir(), 'axya_streams');
const STREAM_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

// Ensure cache dir exists at module load
try { fs.mkdirSync(STREAM_CACHE_DIR, { recursive: true }); } catch { }

// Prevents double-download when player sends multiple Range requests at once
const streamDownloadLocks = new Map<string, Promise<string>>();

async function ensureStreamCached(
    fileId: string,
    ownerSessionString: string,
    telegramMessageId: string,
    telegramChatId: string,
): Promise<string> {
    const cachePath = path.join(STREAM_CACHE_DIR, `${fileId}.cache`);

    // Already cached and fresh?
    try {
        const stat = fs.statSync(cachePath);
        if (stat.size > 0 && (Date.now() - stat.mtimeMs) < STREAM_CACHE_TTL_MS) {
            return cachePath;
        }
    } catch { /* not cached */ }

    // Already downloading? Wait on the same promise
    if (streamDownloadLocks.has(fileId)) {
        return streamDownloadLocks.get(fileId)!;
    }

    // Start new download
    const downloadPromise = (async () => {
        try {
            const messageId = Number.parseInt(String(telegramMessageId || ''), 10);
            const chatId = String(telegramChatId || '').trim();
            if (!chatId || !Number.isFinite(messageId) || messageId <= 0) {
                throw new Error('File source metadata is invalid');
            }

            const clients = await getTelegramReadClients(ownerSessionString);
            const resolved = await resolveMessageFromTelegramClients(clients, chatId, messageId);
            if (!resolved) {
                throw new Error('File no longer exists in Telegram');
            }

            const result = await resolved.client.downloadMedia(resolved.message as any, {
                outputFile: cachePath,
            } as any);

            const diskPath = typeof result === 'string' ? result : cachePath;
            if (!fs.existsSync(diskPath) || fs.statSync(diskPath).size === 0) {
                throw new Error('Download to disk failed');
            }
            if (diskPath !== cachePath) {
                fs.renameSync(diskPath, cachePath);
            }

            return cachePath;
        } finally {
            streamDownloadLocks.delete(fileId);
        }
    })();

    streamDownloadLocks.set(fileId, downloadPromise);
    return downloadPromise;
}

export const streamFile = async (req: AuthRequest, res: Response) => {
    if (!req.user) return res.status(401).json({ success: false, error: 'Unauthorized' });
    const { id } = req.params;

    try {
        const fileResult = await pool.query(
            'SELECT telegram_message_id, telegram_chat_id, mime_type, file_name, file_size FROM files WHERE id = $1 AND user_id = $2 AND is_trashed = false',
            [id, req.user.id]
        );
        if (fileResult.rows.length === 0) return res.status(404).json({ success: false, error: 'File not found' });

        const { telegram_message_id, telegram_chat_id, mime_type, file_name } = fileResult.rows[0];

        // Download to cache (or use existing cache)
        const cachePath = await ensureStreamCached(String(id), req.user.sessionString, String(telegram_message_id), String(telegram_chat_id));

        const stat = fs.statSync(cachePath);
        const totalSize = stat.size;
        const mimeType = mime_type || 'application/octet-stream';

        // ── HTTP Range support ─────────────────────────────────────────────
        const rangeHeader = req.headers.range;
        let start = 0;
        let end = totalSize - 1;
        let isRangeRequest = false;

        if (rangeHeader) {
            const match = rangeHeader.match(/bytes=(\d*)-(\d*)/);
            if (match) {
                start = match[1] ? parseInt(match[1], 10) : 0;
                end = match[2] ? parseInt(match[2], 10) : totalSize - 1;
                isRangeRequest = true;
            }

            if (start < 0 || end < start || start >= totalSize) {
                res.status(416).set({ 'Content-Range': `bytes */${totalSize}` });
                return res.end();
            }
            end = Math.min(end, totalSize - 1);
        }

        const chunkLength = end - start + 1;

        const headers: Record<string, string> = {
            'Content-Type': mimeType,
            'Accept-Ranges': 'bytes',
            'Content-Length': String(chunkLength),
            'Cache-Control': 'private, max-age=3600',
            'Content-Disposition': `inline; filename="${encodeURIComponent(file_name)}"`,
        };

        if (isRangeRequest) {
            headers['Content-Range'] = `bytes ${start}-${end}/${totalSize}`;
            res.status(206).set(headers);
        } else {
            res.status(200).set(headers);
        }

        // Stream from disk cache — instant for Range requests
        const stream = fs.createReadStream(cachePath, { start, end });
        stream.on('error', (err) => {
            logger.error('backend.stream', 'stream_read_error', { fileId: id, message: err.message });
            if (!res.headersSent) res.status(500).json({ success: false, error: 'Stream read failed' });
        });
        stream.pipe(res);

    } catch (err: any) {
        logger.error('backend.stream', 'stream_failed', {
            fileId: id,
            userId: req.user!.id,
            message: err.message,
            stack: err.stack,
        });
        if (!res.headersSent) res.status(500).json({ success: false, error: err.message });
    }
};


// ─────────────────────────────────────────────────────────────────────────────
// FOLDERS: CREATE
// ─────────────────────────────────────────────────────────────────────────────
export const createFolder = async (req: AuthRequest, res: Response) => {
    if (!req.user) return res.status(401).json({ success: false, error: 'Unauthorized' });
    const { name, parent_id = null, color = '#3174ff' } = req.body;
    if (!name?.trim()) return res.status(400).json({ success: false, error: 'Folder name required' });

    try {
        const checkDuplicate = await pool.query(
            `SELECT id FROM folders WHERE user_id = $1 AND name = $2 AND parent_id ${parent_id ? '= $3' : 'IS NULL'} AND is_trashed = false`,
            parent_id ? [req.user.id, name.trim(), parent_id] : [req.user.id, name.trim()]
        );
        if (checkDuplicate.rows.length > 0) {
            return res.status(400).json({ success: false, error: 'A folder with this name already exists in this location.' });
        }

        const result = await pool.query(
            `INSERT INTO folders (user_id, name, parent_id, color) VALUES ($1, $2, $3, $4) RETURNING *`,
            [req.user.id, name.trim(), parent_id || null, color]
        );
        await logActivity(req.user.id, 'create_folder', undefined, result.rows[0].id, { name });
        res.status(201).json({ success: true, folder: result.rows[0] });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// FOLDERS: LIST (with recursive file counts)
// ─────────────────────────────────────────────────────────────────────────────
export const fetchFolders = async (req: AuthRequest, res: Response) => {
    if (!req.user) return res.status(401).json({ success: false, error: 'Unauthorized' });
    const { parent_id, sort, order } = req.query;

    // Whitelist allowed sort columns to prevent SQL injection
    const ALLOWED_SORT: Record<string, string> = {
        name: 'f.name',
        created_at: 'f.created_at',
        file_count: 'file_count',
    };
    const sortCol = ALLOWED_SORT[sort as string] || 'f.created_at';
    const sortOrder = (order as string)?.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

    try {
        // Use recursive CTE to count all files in folder and subfolders
        let query = `
            WITH RECURSIVE folder_tree AS (
                -- Base case: direct children of the requested parent
                SELECT id, user_id FROM folders
                WHERE user_id = $1 AND is_trashed = false
                ${parent_id ? 'AND parent_id = $2' : 'AND parent_id IS NULL'}
                
                UNION ALL
                -- Recursive case: all descendants
                SELECT f.id, f.user_id
                FROM folders f
                INNER JOIN folder_tree ft ON f.parent_id = ft.id
                WHERE f.user_id = $1 AND f.is_trashed = false
            ),
            folder_file_counts AS (
                SELECT ft.id as folder_id, COUNT(fi.id)::int as total_files
                FROM folder_tree ft
                LEFT JOIN files fi ON fi.folder_id = ft.id AND fi.is_trashed = false
                GROUP BY ft.id
            )
            SELECT f.*, 
                   COALESCE(direct_files.file_count, 0)::int as file_count,
                   COALESCE(total_files.total_files, 0)::int as total_file_count,
                   COALESCE(subfolder_count.subfolders, 0)::int as folder_count
            FROM folders f
            LEFT JOIN (
                SELECT folder_id, COUNT(*)::int as file_count 
                FROM files WHERE is_trashed = false GROUP BY folder_id
            ) direct_files ON direct_files.folder_id = f.id
            LEFT JOIN folder_file_counts total_files ON total_files.folder_id = f.id
            LEFT JOIN (
                SELECT parent_id, COUNT(*)::int as subfolders 
                FROM folders WHERE is_trashed = false GROUP BY parent_id
            ) subfolder_count ON subfolder_count.parent_id = f.id
            WHERE f.user_id = $1 AND f.is_trashed = false
        `;
        const params: any[] = [req.user.id];

        if (parent_id) {
            params.push(parent_id);
            query += ` AND f.parent_id = $${params.length}`;
        } else {
            query += ` AND f.parent_id IS NULL`;
        }

        query += ` ORDER BY ${sortCol} ${sortOrder}`;

        const result = await pool.query(query, params);
        res.json({ success: true, folders: result.rows });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// FOLDERS: UPDATE
// ─────────────────────────────────────────────────────────────────────────────
export const updateFolder = async (req: AuthRequest, res: Response) => {
    if (!req.user) return res.status(401).json({ success: false, error: 'Unauthorized' });
    const { id } = req.params;
    const { name, color } = req.body;

    const updates: string[] = [];
    const values: any[] = [];

    if (name?.trim()) {
        // Check for duplicate name at the same folder level (excluding itself)
        const folderRow = await pool.query(`SELECT parent_id FROM folders WHERE id = $1 AND user_id = $2`, [id, req.user.id]);
        if (folderRow.rows.length > 0) {
            const parentId = folderRow.rows[0].parent_id;
            const dupCheck = await pool.query(
                `SELECT id FROM folders WHERE user_id = $1 AND name = $2 AND parent_id ${parentId ? '= $3' : 'IS NULL'} AND id != $${parentId ? '4' : '3'} AND is_trashed = false`,
                parentId ? [req.user.id, name.trim(), parentId, id] : [req.user.id, name.trim(), id]
            );
            if (dupCheck.rows.length > 0) {
                return res.status(400).json({ success: false, error: 'A folder with this name already exists in this location.' });
            }
        }
        values.push(name.trim()); updates.push(`name = $${values.length}`);
    }
    if (color) { values.push(color); updates.push(`color = $${values.length}`); }
    if (updates.length === 0) return res.status(400).json({ success: false, error: 'Nothing to update' });

    values.push(id); values.push(req.user.id);

    try {
        const result = await pool.query(
            `UPDATE folders SET ${updates.join(', ')} WHERE id = $${values.length - 1} AND user_id = $${values.length} RETURNING *`,
            values
        );
        if (result.rows.length === 0) return res.status(404).json({ success: false, error: 'Folder not found' });
        res.json({ success: true, folder: result.rows[0] });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// FOLDERS: TRASH (Cascade — soft-deletes all nested sub-folders + their files)
// ─────────────────────────────────────────────────────────────────────────────
export const trashFolder = async (req: AuthRequest, res: Response) => {
    if (!req.user) return res.status(401).json({ success: false, error: 'Unauthorized' });
    const { id } = req.params;

    try {
        // Recursively find ALL descendant folder IDs (including the root)
        const descendantsRes = await pool.query(`
            WITH RECURSIVE subtree AS (
                SELECT id FROM folders WHERE id = $1 AND user_id = $2
                UNION ALL
                SELECT f.id FROM folders f INNER JOIN subtree s ON f.parent_id = s.id
            )
            SELECT id FROM subtree
        `, [id, req.user.id]);

        const folderIds = descendantsRes.rows.map(r => r.id);
        if (folderIds.length === 0) return res.status(404).json({ success: false, error: 'Folder not found' });

        // Soft-delete all descendant folders
        await pool.query(
            `UPDATE folders SET is_trashed = true, trashed_at = NOW() WHERE id = ANY($1::uuid[]) AND user_id = $2`,
            [folderIds, req.user.id]
        );
        // Soft-delete all files inside any of those folders
        await pool.query(
            `UPDATE files SET is_trashed = true, trashed_at = NOW() WHERE folder_id = ANY($1::uuid[]) AND user_id = $2`,
            [folderIds, req.user.id]
        );
        await logActivity(req.user.id, 'trash_folder', undefined, id as string);

        res.json({ success: true, message: `Folder and ${folderIds.length - 1} sub-folder(s) moved to trash.` });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// STATS
// ─────────────────────────────────────────────────────────────────────────────
export const getStats = async (req: AuthRequest, res: Response) => {
    if (!req.user) return res.status(401).json({ success: false, error: 'Unauthorized' });

    try {
        const [fileStats, folderCount, trashCount, starredCount, byType] = await Promise.all([
            pool.query(
                `SELECT count(*)::int as total_files, COALESCE(sum(file_size), 0)::bigint as total_bytes
                 FROM files WHERE user_id = $1 AND is_trashed = false`, [req.user.id]
            ),
            pool.query(`SELECT count(*)::int as total FROM folders WHERE user_id = $1 AND is_trashed = false`, [req.user.id]),
            pool.query(`SELECT count(*)::int as total FROM files WHERE user_id = $1 AND is_trashed = true`, [req.user.id]),
            pool.query(`SELECT count(*)::int as total FROM files WHERE user_id = $1 AND is_starred = true AND is_trashed = false`, [req.user.id]),
            pool.query(
                `SELECT
                   CASE
                     WHEN mime_type ILIKE 'image/%' THEN 'image'
                     WHEN mime_type ILIKE 'video/%' THEN 'video'
                     WHEN mime_type ILIKE 'audio/%' THEN 'audio'
                     WHEN mime_type ILIKE 'application/pdf' THEN 'pdf'
                     WHEN mime_type ILIKE '%zip%' OR mime_type ILIKE '%compress%' THEN 'archive'
                     ELSE 'other'
                   END as category,
                   COUNT(*)::int as count,
                   COALESCE(SUM(file_size), 0)::bigint as bytes
                 FROM files WHERE user_id = $1 AND is_trashed = false
                 GROUP BY category`, [req.user.id]
            ),
        ]);

        const byTypeRows = byType.rows;
        const imageRow = byTypeRows.find((r: any) => r.category === 'image');
        const videoRow = byTypeRows.find((r: any) => r.category === 'video');

        res.json({
            success: true,
            totalFiles: fileStats.rows[0].total_files,
            totalBytes: parseInt(fileStats.rows[0].total_bytes),
            totalFolders: folderCount.rows[0].total,
            trashCount: trashCount.rows[0].total,
            starredCount: starredCount.rows[0].total,
            // Flat convenience fields for mobile storage card
            image_count: imageRow ? imageRow.count : 0,
            video_count: videoRow ? videoRow.count : 0,
            storageByType: byTypeRows,
        });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// ACTIVITY LOG
// ─────────────────────────────────────────────────────────────────────────────
export const getActivity = async (req: AuthRequest, res: Response) => {
    if (!req.user) return res.status(401).json({ success: false, error: 'Unauthorized' });
    const rawLimit = Number(req.query.limit);
    const limit = Number.isFinite(rawLimit)
        ? Math.min(Math.max(Math.floor(rawLimit), 1), 20)
        : 5;

    try {
        const result = await pool.query(
            `SELECT al.*, f.file_name FROM activity_log al
             LEFT JOIN files f ON f.id = al.file_id
             WHERE al.user_id = $1 ORDER BY al.created_at DESC LIMIT $2`,
            [req.user.id, limit]
        );
        res.json({ success: true, activity: result.rows });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// BULK ACTIONS — star, trash, move multiple files at once
// ─────────────────────────────────────────────────────────────────────────────
export const bulkAction = async (req: AuthRequest, res: Response) => {
    if (!req.user) return res.status(401).json({ success: false, error: 'Unauthorized' });
    const { ids, action, folder_id } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ success: false, error: 'ids array required' });
    if (ids.length > 200) return res.status(400).json({ success: false, error: 'max 200 ids per request' });
    if (ids.some((id: unknown) => typeof id !== 'string' || !id.trim())) {
        return res.status(400).json({ success: false, error: 'ids must be non-empty strings' });
    }

    try {
        switch (action) {
            case 'trash':
                await pool.query(`UPDATE files SET is_trashed = true, trashed_at = NOW() WHERE id = ANY($1::uuid[]) AND user_id = $2`, [ids, req.user.id]);
                break;
            case 'restore':
                await pool.query(`UPDATE files SET is_trashed = false, trashed_at = NULL WHERE id = ANY($1::uuid[]) AND user_id = $2`, [ids, req.user.id]);
                break;
            case 'star':
                await pool.query(`UPDATE files SET is_starred = true WHERE id = ANY($1::uuid[]) AND user_id = $2`, [ids, req.user.id]);
                break;
            case 'unstar':
                await pool.query(`UPDATE files SET is_starred = false WHERE id = ANY($1::uuid[]) AND user_id = $2`, [ids, req.user.id]);
                break;
            case 'move':
                if (folder_id === undefined) return res.status(400).json({ success: false, error: 'folder_id required for move' });
                await pool.query(`UPDATE files SET folder_id = $1, updated_at = NOW() WHERE id = ANY($2::uuid[]) AND user_id = $3`, [folder_id || null, ids, req.user.id]);
                break;
            case 'delete':
                // Hard delete from DB only (Telegram message stays — user may have shared it)
                await pool.query(`DELETE FROM files WHERE id = ANY($1::uuid[]) AND user_id = $2 AND is_trashed = true`, [ids, req.user.id]);
                break;
            default:
                return res.status(400).json({ success: false, error: 'Unknown action. Use: trash, restore, star, unstar, move, delete' });
        }
        res.json({ success: true, affected: ids.length });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// FILE TAGS
// ─────────────────────────────────────────────────────────────────────────────
export const addTag = async (req: AuthRequest, res: Response) => {
    if (!req.user) return res.status(401).json({ success: false, error: 'Unauthorized' });
    const { id } = req.params;
    const { tag } = req.body;
    if (!tag?.trim()) return res.status(400).json({ success: false, error: 'tag required' });
    try {
        await pool.query(
            `INSERT INTO file_tags (file_id, tag, user_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
            [id, tag.trim().toLowerCase(), req.user.id]
        );
        res.json({ success: true });
    } catch (err: any) { res.status(500).json({ success: false, error: err.message }); }
};

export const removeTag = async (req: AuthRequest, res: Response) => {
    if (!req.user) return res.status(401).json({ success: false, error: 'Unauthorized' });
    const { id, tag } = req.params;
    try {
        await pool.query(`DELETE FROM file_tags WHERE file_id = $1 AND tag = $2 AND user_id = $3`, [id, tag, req.user.id]);
        res.json({ success: true });
    } catch (err: any) { res.status(500).json({ success: false, error: err.message }); }
};

export const getFileTags = async (req: AuthRequest, res: Response) => {
    if (!req.user) return res.status(401).json({ success: false, error: 'Unauthorized' });
    const { id } = req.params;
    try {
        const result = await pool.query(`SELECT tag FROM file_tags WHERE file_id = $1 AND user_id = $2 ORDER BY tag`, [id, req.user.id]);
        res.json({ success: true, tags: result.rows.map(r => r.tag) });
    } catch (err: any) { res.status(500).json({ success: false, error: err.message }); }
};

export const getFilesByTag = async (req: AuthRequest, res: Response) => {
    if (!req.user) return res.status(401).json({ success: false, error: 'Unauthorized' });
    const { tag } = req.query;
    if (!tag) return res.status(400).json({ success: false, error: 'tag required' });
    try {
        const result = await pool.query(
            `SELECT f.* FROM files f INNER JOIN file_tags ft ON ft.file_id = f.id
             WHERE ft.user_id = $1 AND ft.tag = $2 AND f.is_trashed = false ORDER BY f.created_at DESC`,
            [req.user.id, tag]
        );
        res.json({ success: true, files: result.rows.map(formatFileRow) });
    } catch (err: any) { res.status(500).json({ success: false, error: err.message }); }
};

export const getAllUserTags = async (req: AuthRequest, res: Response) => {
    if (!req.user) return res.status(401).json({ success: false, error: 'Unauthorized' });
    try {
        const result = await pool.query(
            `SELECT tag, COUNT(*)::int as count FROM file_tags WHERE user_id = $1 GROUP BY tag ORDER BY count DESC`,
            [req.user.id]
        );
        res.json({ success: true, tags: result.rows });
    } catch (err: any) { res.status(500).json({ success: false, error: err.message }); }
};

// ─────────────────────────────────────────────────────────────────────────────
// RECENTLY ACCESSED — track when a file is opened
// ─────────────────────────────────────────────────────────────────────────────
export const markAccessed = async (req: AuthRequest, res: Response) => {
    if (!req.user) return res.status(401).json({ success: false, error: 'Unauthorized' });
    const { id } = req.params;
    try {
        await pool.query(`UPDATE files SET last_accessed_at = NOW() WHERE id = $1 AND user_id = $2`, [id, req.user.id]);
        res.json({ success: true });
    } catch (err: any) { res.status(500).json({ success: false, error: err.message }); }
};

export const getRecentlyAccessed = async (req: AuthRequest, res: Response) => {
    if (!req.user) return res.status(401).json({ success: false, error: 'Unauthorized' });
    try {
        const result = await pool.query(
            `SELECT * FROM files WHERE user_id = $1 AND is_trashed = false AND last_accessed_at IS NOT NULL
             ORDER BY last_accessed_at DESC LIMIT 10`,
            [req.user.id]
        );
        res.json({ success: true, files: result.rows.map(formatFileRow) });
    } catch (err: any) { res.status(500).json({ success: false, error: err.message }); }
};

// ─────────────────────────────────────────────────────────────────────────────
// FILE DETAILS (with tags + share link info + integrity)
// ─────────────────────────────────────────────────────────────────────────────
export const getFileDetails = async (req: AuthRequest, res: Response) => {
    if (!req.user) return res.status(401).json({ success: false, error: 'Unauthorized' });
    const { id } = req.params;
    try {
        const [fileRes, tagsRes, shareRes] = await Promise.all([
            pool.query(`SELECT f.*, fo.name as folder_name FROM files f LEFT JOIN folders fo ON fo.id = f.folder_id WHERE f.id = $1 AND f.user_id = $2`, [id, req.user.id]),
            pool.query(`SELECT tag FROM file_tags WHERE file_id = $1 AND user_id = $2 ORDER BY tag`, [id, req.user.id]),
            pool.query(
                `SELECT id, slug, expires_at, allow_download, allow_preview
                 FROM share_links_v2
                 WHERE root_file_id = $1 AND owner_user_id = $2
                 ORDER BY created_at DESC
                 LIMIT 1`,
                [id, req.user.id]
            ),
        ]);
        if (fileRes.rows.length === 0) return res.status(404).json({ success: false, error: 'File not found' });

        const file = fileRes.rows[0];
        const latestShare = shareRes.rows[0] as { id: string; slug: string; expires_at: string | null; allow_download: boolean; allow_preview: boolean } | undefined;
        const shareLink = latestShare ? {
            id: latestShare.id,
            slug: latestShare.slug,
            expires_at: latestShare.expires_at,
            allow_download: Boolean(latestShare.allow_download),
            allow_preview: Boolean(latestShare.allow_preview),
            // The secret is intentionally not persisted/recoverable; create a new share if a full URL is needed.
            share_url: null,
            shareUrl: null,
        } : null;

        res.json({
            success: true,
            file: { ...formatFileRow(file), folder_name: file.folder_name, sha256_hash: file.sha256_hash },
            tags: tagsRes.rows.map(r => r.tag),
            shareLink,
        });
    } catch (err: any) { res.status(500).json({ success: false, error: err.message }); }
};

