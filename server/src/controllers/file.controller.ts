import { Response } from 'express';
import { AuthRequest } from '../middlewares/auth.middleware';
import { getDynamicClient } from '../services/telegram.service';
import { CustomFile } from 'telegram/client/uploads';
import pool from '../config/db';
import fs from 'fs';
import path from 'path';

// ── Allowed MIME types ─────────────────────────────────────────────────────
const ALLOWED_TYPES = [
    'image/', 'video/', 'audio/', 'application/pdf',
    'text/', 'application/zip', 'application/x-zip',
    'application/msword', 'application/vnd.openxmlformats',
    'application/vnd.ms-', 'application/json', 'application/xml',
];

const isAllowedMime = (mime: string) => ALLOWED_TYPES.some(t => mime.startsWith(t));

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
});

// ─────────────────────────────────────────────────────────────────────────────
// UPLOAD
// ─────────────────────────────────────────────────────────────────────────────
export const uploadFile = async (req: AuthRequest, res: Response) => {
    // 🔍 Debug: log what we actually receive
    console.log('[upload] req.user =', req.user ? { id: req.user.id, phone: req.user.phone } : 'MISSING');
    console.log('[upload] req.file =', req.file ? { name: req.file.originalname, size: req.file.size } : 'MISSING');

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
            caption: `[TeleDrive] ${originalname}`,
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

    const { limit = '50', offset = '0', folder_id, sort = 'created_at', order = 'DESC' } = req.query;
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
    params.push(parseInt(limit as string, 10));
    query += ` LIMIT $${params.length}`;
    params.push(parseInt(offset as string, 10));
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

        filesQuery += ` ORDER BY f.created_at DESC LIMIT 50`;

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

        foldersQuery += ` LIMIT 20`;

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
            results: merged
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
        values.push(file_name.trim());
        updates.push(`file_name = $${values.length}`);
    }
    if (folder_id !== undefined) {
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
            const client = await getDynamicClient(req.user.sessionString);
            await client.deleteMessages(String(telegram_chat_id), [parseInt(telegram_message_id, 10)], { revoke: true });
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
// DOWNLOAD / STREAM
// ─────────────────────────────────────────────────────────────────────────────
export const downloadFile = async (req: AuthRequest, res: Response) => {
    if (!req.user) return res.status(401).json({ success: false, error: 'Unauthorized' });
    const { id } = req.params;

    try {
        const fileResult = await pool.query(
            'SELECT telegram_message_id, telegram_chat_id, mime_type, file_name, file_size FROM files WHERE id = $1 AND user_id = $2 AND is_trashed = false',
            [id, req.user.id]
        );
        if (fileResult.rows.length === 0) return res.status(404).json({ success: false, error: 'File not found' });

        const { telegram_message_id, telegram_chat_id, mime_type, file_name, file_size } = fileResult.rows[0];
        const client = await getDynamicClient(req.user.sessionString);

        const messages = await client.getMessages(telegram_chat_id, { ids: parseInt(telegram_message_id, 10) });
        if (!messages || messages.length === 0) return res.status(404).json({ success: false, error: 'File no longer exists in Telegram' });

        const buffer = await client.downloadMedia(messages[0] as any);
        if (!buffer) return res.status(500).json({ success: false, error: 'Failed to retrieve file stream' });

        res.set('Content-Type', mime_type || 'application/octet-stream');
        res.set('Content-Disposition', `inline; filename="${encodeURIComponent(file_name)}"`);
        res.set('Content-Length', buffer.length.toString());
        res.set('Cache-Control', 'private, max-age=3600');
        res.send(buffer);
    } catch (err: any) {
        if (!res.headersSent) res.status(500).json({ success: false, error: err.message });
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// THUMBNAIL (MTProto)
// ─────────────────────────────────────────────────────────────────────────────
export const getThumbnail = async (req: AuthRequest, res: Response) => {
    if (!req.user) return res.status(401).json({ success: false, error: 'Unauthorized' });
    const { id } = req.params;

    try {
        const fileResult = await pool.query(
            'SELECT telegram_message_id, telegram_chat_id, mime_type, file_name, file_size FROM files WHERE id = $1 AND user_id = $2 AND is_trashed = false',
            [id, req.user.id]
        );
        if (fileResult.rows.length === 0) return res.status(404).json({ success: false, error: 'File not found' });

        const { telegram_message_id, telegram_chat_id, mime_type } = fileResult.rows[0];
        const client = await getDynamicClient(req.user.sessionString);

        const messages = await client.getMessages(telegram_chat_id, { ids: parseInt(telegram_message_id, 10) });
        if (!messages || messages.length === 0) return res.status(404).json({ success: false, error: 'File no longer exists' });

        // Try getting a small thumbnail
        const buffer = await client.downloadMedia(messages[0] as any, { thumb: 0 });
        if (!buffer) return res.status(404).json({ success: false, error: 'No thumbnail available' });

        res.set('Content-Type', 'image/jpeg'); // thumbnails are usually jpeg
        res.set('Cache-Control', 'public, max-age=86400');
        res.send(buffer);
    } catch (err: any) {
        if (!res.headersSent) res.status(500).json({ success: false, error: err.message });
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// STREAM MEDIA (Bot API Redirect)
// ─────────────────────────────────────────────────────────────────────────────
export const streamFile = async (req: AuthRequest, res: Response) => {
    if (!req.user) return res.status(401).json({ success: false, error: 'Unauthorized' });
    const { id } = req.params;

    try {
        const fileResult = await pool.query(
            'SELECT telegram_file_id FROM files WHERE id = $1 AND user_id = $2 AND is_trashed = false',
            [id, req.user.id]
        );
        if (fileResult.rows.length === 0) return res.status(404).json({ success: false, error: 'File not found' });

        const { telegram_file_id } = fileResult.rows[0];

        let BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
        // Fix for UTF-16/spaced env keys if any
        if (!BOT_TOKEN) {
            const botKey = Object.keys(process.env).find(k => k.replace(/\\s/g, '').includes('TELEGRAM_BOT_TOKEN'));
            if (botKey) BOT_TOKEN = process.env[botKey];
        }

        if (!BOT_TOKEN || BOT_TOKEN.includes('PUT_YOUR_BOT_TOKEN_HERE') || !BOT_TOKEN.trim()) {
            return res.status(500).json({ success: false, error: 'TELEGRAM_BOT_TOKEN not properly configured in .env' });
        }

        const resp = await fetch(`https://api.telegram.org/bot${BOT_TOKEN.trim()}/getFile?file_id=${telegram_file_id}`);
        const data = await resp.json();

        if (!data.ok) return res.status(400).json({ success: false, error: data.description || 'Failed to get file path from Telegram' });

        const streamUrl = `https://api.telegram.org/file/bot${BOT_TOKEN.trim()}/${data.result.file_path}`;

        res.redirect(streamUrl);
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
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
// FOLDERS: LIST
// ─────────────────────────────────────────────────────────────────────────────
export const fetchFolders = async (req: AuthRequest, res: Response) => {
    if (!req.user) return res.status(401).json({ success: false, error: 'Unauthorized' });
    const { parent_id } = req.query;

    try {
        let query = `
            SELECT f.*, COUNT(fi.id)::int as file_count
            FROM folders f
            LEFT JOIN files fi ON fi.folder_id = f.id AND fi.is_trashed = false
            WHERE f.user_id = $1 AND f.is_trashed = false
        `;
        const params: any[] = [req.user.id];

        if (parent_id) {
            params.push(parent_id);
            query += ` AND f.parent_id = $${params.length}`;
        } else {
            query += ` AND f.parent_id IS NULL`;
        }

        query += ` GROUP BY f.id ORDER BY f.created_at DESC`;

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

        res.json({
            success: true,
            totalFiles: fileStats.rows[0].total_files,
            totalBytes: parseInt(fileStats.rows[0].total_bytes),
            totalFolders: folderCount.rows[0].total,
            trashCount: trashCount.rows[0].total,
            starredCount: starredCount.rows[0].total,
            storageByType: byType.rows,
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

    try {
        const result = await pool.query(
            `SELECT al.*, f.file_name FROM activity_log al
             LEFT JOIN files f ON f.id = al.file_id
             WHERE al.user_id = $1 ORDER BY al.created_at DESC LIMIT 50`,
            [req.user.id]
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
            pool.query(`SELECT token, expires_at, download_count, is_public FROM shared_links WHERE file_id = $1`, [id]),
        ]);
        if (fileRes.rows.length === 0) return res.status(404).json({ success: false, error: 'File not found' });

        const file = fileRes.rows[0];
        res.json({
            success: true,
            file: { ...formatFileRow(file), folder_name: file.folder_name, sha256_hash: file.sha256_hash },
            tags: tagsRes.rows.map(r => r.tag),
            shareLink: shareRes.rows[0] || null,
        });
    } catch (err: any) { res.status(500).json({ success: false, error: err.message }); }
};
