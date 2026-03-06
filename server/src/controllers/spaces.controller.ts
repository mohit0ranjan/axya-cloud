import { Request, Response } from 'express';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import pool from '../config/db';
import { AuthRequest } from '../middlewares/auth.middleware';
import { getDynamicClient } from '../services/telegram.service';
import { CustomFile } from 'telegram/client/uploads';

const DOWNLOAD_TOKEN_TTL_SECONDS = 10 * 60;
const SPACE_ACCESS_COOKIE_PREFIX = 'space_access_';
const SIGNED_DOWNLOAD_SECRET = process.env.SIGNED_DOWNLOAD_SECRET || process.env.JWT_SECRET || 'axya_signed_download_secret';
const SPACE_ACCESS_SECRET = process.env.SPACE_ACCESS_SECRET || process.env.JWT_SECRET || 'axya_space_access_secret';
const MAX_UPLOAD_BYTES = Number.parseInt(process.env.SHARED_SPACE_MAX_UPLOAD_BYTES || '', 10) || 200 * 1024 * 1024;
const TMP_DOWNLOAD_DIR = path.join(os.tmpdir(), 'axya_space_downloads');

try {
    fs.mkdirSync(TMP_DOWNLOAD_DIR, { recursive: true });
} catch {
    // best effort
}

const ALLOWED_MIME_PREFIXES = [
    'image/',
    'video/',
    'audio/',
    'application/pdf',
    'text/',
    'application/zip',
    'application/x-zip',
    'application/json',
    'application/xml',
];

const isMimeAllowed = (mimeType: string): boolean => {
    if (!mimeType) return false;
    return ALLOWED_MIME_PREFIXES.some((allowed) => mimeType.startsWith(allowed));
};

const safeFolderPath = (value: unknown): string => {
    const raw = String(value || '/').trim();
    const normalized = raw.startsWith('/') ? raw : `/${raw}`;
    return normalized
        .replace(/\/+/g, '/')
        .replace(/\.\./g, '')
        .replace(/[^a-zA-Z0-9/_\- .]/g, '')
        .slice(0, 255) || '/';
};

const getIp = (req: Request): string => {
    const fwd = req.headers['x-forwarded-for'];
    if (Array.isArray(fwd) && fwd.length > 0) return String(fwd[0]);
    if (typeof fwd === 'string' && fwd.length > 0) return fwd.split(',')[0].trim();
    return req.ip || 'unknown';
};

const isSpaceExpired = (expiresAt: string | Date | null): boolean => {
    if (!expiresAt) return false;
    return new Date(expiresAt).getTime() < Date.now();
};

const signSpaceAccessToken = (spaceId: string): string => {
    return jwt.sign({ t: 'space_access', spaceId }, SPACE_ACCESS_SECRET, { expiresIn: '24h' });
};

const readSpaceAccessToken = (req: Request, spaceId: string): string | null => {
    const headerToken = req.headers['x-space-access-token'];
    if (typeof headerToken === 'string' && headerToken) return headerToken;
    const cookieToken = req.cookies?.[`${SPACE_ACCESS_COOKIE_PREFIX}${spaceId}`];
    return cookieToken ? String(cookieToken) : null;
};

const hasSpacePasswordAccess = (req: Request, spaceId: string): boolean => {
    const token = readSpaceAccessToken(req, spaceId);
    if (!token) return false;
    try {
        const payload = jwt.verify(token, SPACE_ACCESS_SECRET) as { t?: string; spaceId?: string };
        return payload?.t === 'space_access' && payload?.spaceId === spaceId;
    } catch {
        return false;
    }
};

const verifySpacePassword = async (password: string, passwordHash: string): Promise<boolean> => {
    if (!passwordHash) return false;
    if (!/^\$2[aby]\$\d{2}\$/.test(passwordHash)) return false;
    try {
        return await bcrypt.compare(password, passwordHash);
    } catch {
        return false;
    }
};

const writeAccessLog = async (spaceId: string, req: Request, action: string): Promise<void> => {
    try {
        await pool.query(
            'INSERT INTO access_logs (space_id, user_ip, action) VALUES ($1, $2, $3)',
            [spaceId, getIp(req), action]
        );
    } catch {
        // non-blocking
    }
};

const signDownloadToken = (spaceId: string, fileId: string): string => {
    return jwt.sign(
        { t: 'space_file', spaceId, fileId },
        SIGNED_DOWNLOAD_SECRET,
        { expiresIn: DOWNLOAD_TOKEN_TTL_SECONDS }
    );
};

const verifyDownloadToken = (token: string, fileId: string): { valid: boolean; spaceId?: string } => {
    try {
        const payload = jwt.verify(token, SIGNED_DOWNLOAD_SECRET) as { t?: string; spaceId?: string; fileId?: string };
        if (payload?.t !== 'space_file') return { valid: false };
        if (payload.fileId !== fileId) return { valid: false };
        if (!payload.spaceId) return { valid: false };
        return { valid: true, spaceId: payload.spaceId };
    } catch {
        return { valid: false };
    }
};

const requireSpaceAccess = async (req: Request, res: Response, spaceId: string) => {
    const spaceRes = await pool.query(
        'SELECT id, name, owner_id, password_hash, allow_upload, allow_download, expires_at, created_at FROM shared_spaces WHERE id = $1',
        [spaceId]
    );
    if (spaceRes.rows.length === 0) {
        res.status(404).json({ success: false, error: 'Shared space not found.' });
        return null;
    }

    const space = spaceRes.rows[0];
    if (isSpaceExpired(space.expires_at)) {
        res.status(410).json({ success: false, error: 'Shared space has expired.' });
        return null;
    }

    if (space.password_hash && !hasSpacePasswordAccess(req, spaceId)) {
        res.status(401).json({ success: false, error: 'Password validation required.' });
        return null;
    }

    return space as {
        id: string;
        name: string;
        owner_id: string;
        password_hash: string | null;
        allow_upload: boolean;
        allow_download: boolean;
        expires_at: string | null;
        created_at: string;
    };
};

export const createSpace = async (req: AuthRequest, res: Response) => {
    if (!req.user) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const name = String(req.body?.name || '').trim();
    const allowUpload = Boolean(req.body?.allow_upload);
    const allowDownload = req.body?.allow_download !== false;
    const password = String(req.body?.password || '').trim();
    const expiresAtRaw = req.body?.expires_at ? new Date(req.body.expires_at) : null;

    if (!name || name.length < 2 || name.length > 120) {
        return res.status(400).json({ success: false, error: 'Space name must be between 2 and 120 characters.' });
    }
    if (expiresAtRaw && Number.isNaN(expiresAtRaw.getTime())) {
        return res.status(400).json({ success: false, error: 'Invalid expires_at date.' });
    }
    if (expiresAtRaw && expiresAtRaw.getTime() <= Date.now()) {
        return res.status(400).json({ success: false, error: 'expires_at must be in the future.' });
    }

    try {
        const passwordHash = password ? await bcrypt.hash(password, 12) : null;
        const result = await pool.query(
            `INSERT INTO shared_spaces (name, owner_id, password_hash, allow_upload, allow_download, expires_at)
             VALUES ($1, $2, $3, $4, $5, $6)
             RETURNING id, name, owner_id, allow_upload, allow_download, expires_at, created_at`,
            [name, req.user.id, passwordHash, allowUpload, allowDownload, expiresAtRaw]
        );

        return res.status(201).json({ success: true, space: result.rows[0] });
    } catch (err: any) {
        return res.status(500).json({ success: false, error: err.message });
    }
};

export const listOwnerSpaces = async (req: AuthRequest, res: Response) => {
    if (!req.user) return res.status(401).json({ success: false, error: 'Unauthorized' });

    try {
        const result = await pool.query(
            `SELECT
               s.id, s.name, s.owner_id, s.allow_upload, s.allow_download, s.expires_at, s.created_at,
               COUNT(f.id)::int AS file_count,
               COALESCE(SUM(f.file_size), 0)::bigint AS total_size
             FROM shared_spaces s
             LEFT JOIN shared_files f ON f.space_id = s.id
             WHERE s.owner_id = $1
             GROUP BY s.id
             ORDER BY s.created_at DESC`,
            [req.user.id]
        );
        return res.json({ success: true, spaces: result.rows });
    } catch (err: any) {
        return res.status(500).json({ success: false, error: err.message });
    }
};

export const getSpacePublic = async (req: Request, res: Response) => {
    const id = String(req.params.id || '');

    try {
        const spaceRes = await pool.query(
            'SELECT id, name, allow_upload, allow_download, expires_at, created_at, password_hash IS NOT NULL AS requires_password FROM shared_spaces WHERE id = $1',
            [id]
        );
        if (spaceRes.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Shared space not found.' });
        }
        const space = spaceRes.rows[0];
        if (isSpaceExpired(space.expires_at)) {
            return res.status(410).json({ success: false, error: 'Shared space has expired.' });
        }

        const hasAccess = !space.requires_password || hasSpacePasswordAccess(req, id);
        await writeAccessLog(id, req, 'space_open');

        return res.json({
            success: true,
            space: {
                id: space.id,
                name: space.name,
                allow_upload: space.allow_upload,
                allow_download: space.allow_download,
                expires_at: space.expires_at,
                created_at: space.created_at,
                requires_password: space.requires_password,
                has_access: hasAccess,
            },
        });
    } catch (err: any) {
        return res.status(500).json({ success: false, error: err.message });
    }
};

export const validateSpacePassword = async (req: Request, res: Response) => {
    const id = String(req.params.id || '');
    const password = String(req.body?.password || '');

    try {
        const spaceRes = await pool.query(
            'SELECT id, password_hash, expires_at FROM shared_spaces WHERE id = $1',
            [id]
        );
        if (spaceRes.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Shared space not found.' });
        }
        const space = spaceRes.rows[0] as { id: string; password_hash: string | null; expires_at: string | null };
        if (isSpaceExpired(space.expires_at)) {
            return res.status(410).json({ success: false, error: 'Shared space has expired.' });
        }
        if (!space.password_hash) {
            return res.json({ success: true, message: 'Space is not password protected.' });
        }

        const ok = await verifySpacePassword(password, String(space.password_hash || ''));
        if (!ok) {
            await writeAccessLog(id, req, 'password_failed');
            return res.status(401).json({ success: false, error: 'Invalid password.' });
        }

        const accessToken = signSpaceAccessToken(id);
        res.cookie(`${SPACE_ACCESS_COOKIE_PREFIX}${id}`, accessToken, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax',
            maxAge: 24 * 60 * 60 * 1000,
            path: '/',
        });
        await writeAccessLog(id, req, 'password_success');

        return res.json({ success: true, access_token: accessToken, expires_in_seconds: 24 * 60 * 60 });
    } catch (err: any) {
        return res.status(500).json({ success: false, error: err.message });
    }
};

export const listSpaceFiles = async (req: Request, res: Response) => {
    const id = String(req.params.id || '');
    const folderPath = safeFolderPath(req.query.folder_path);

    try {
        const space = await requireSpaceAccess(req, res, id);
        if (!space) return;

        const filesRes = await pool.query(
            `SELECT id, file_name, file_size, mime_type, uploaded_by, created_at, folder_path
             FROM shared_files
             WHERE space_id = $1 AND folder_path = $2
             ORDER BY created_at DESC`,
            [id, folderPath]
        );

        const allFoldersRes = await pool.query(
            `SELECT DISTINCT folder_path FROM shared_files WHERE space_id = $1`,
            [id]
        );

        const requestedPrefix = folderPath.endsWith('/') ? folderPath : `${folderPath}/`;
        const childFolders = new Set<string>();
        allFoldersRes.rows.forEach((row: { folder_path: string }) => {
            const candidate = row.folder_path || '/';
            if (!candidate.startsWith(requestedPrefix)) return;
            const rest = candidate.slice(requestedPrefix.length);
            if (!rest) return;
            const firstSegment = rest.split('/').filter(Boolean)[0];
            if (firstSegment) childFolders.add(firstSegment);
        });

        await writeAccessLog(id, req, 'list_files');

        return res.json({
            success: true,
            space: {
                id: space.id,
                name: space.name,
                allow_upload: space.allow_upload,
                allow_download: space.allow_download,
                expires_at: space.expires_at,
            },
            folder_path: folderPath,
            folders: Array.from(childFolders).sort().map((name) => ({
                name,
                path: folderPath === '/' ? `/${name}` : `${folderPath}/${name}`,
            })),
            files: filesRes.rows.map((row: any) => ({
                ...row,
                download_url: space.allow_download
                    ? `/api/files/${row.id}/download?sig=${encodeURIComponent(signDownloadToken(id, row.id))}`
                    : null,
            })),
        });
    } catch (err: any) {
        return res.status(500).json({ success: false, error: err.message });
    }
};

export const uploadToSpace = async (req: Request, res: Response) => {
    const id = String(req.params.id || '');
    const folderPath = safeFolderPath(req.body?.folder_path);
    const uploadFile = req.file;

    if (!uploadFile) {
        return res.status(400).json({ success: false, error: 'No file uploaded.' });
    }
    if (uploadFile.size > MAX_UPLOAD_BYTES) {
        try { fs.unlinkSync(uploadFile.path); } catch { }
        return res.status(413).json({ success: false, error: `File exceeds max upload size (${MAX_UPLOAD_BYTES} bytes).` });
    }
    if (!isMimeAllowed(uploadFile.mimetype || '')) {
        try { fs.unlinkSync(uploadFile.path); } catch { }
        return res.status(400).json({ success: false, error: `Unsupported file type: ${uploadFile.mimetype || 'unknown'}` });
    }

    try {
        const space = await requireSpaceAccess(req, res, id);
        if (!space) return;
        if (!space.allow_upload) {
            try { fs.unlinkSync(uploadFile.path); } catch { }
            return res.status(403).json({ success: false, error: 'Uploads are disabled for this space.' });
        }

        const ownerRes = await pool.query('SELECT session_string FROM users WHERE id = $1', [space.owner_id]);
        if (ownerRes.rows.length === 0) {
            try { fs.unlinkSync(uploadFile.path); } catch { }
            return res.status(404).json({ success: false, error: 'Space owner session unavailable.' });
        }

        const sessionString = String(ownerRes.rows[0].session_string);
        const telegramClient = await getDynamicClient(sessionString);
        const uploadedMessage = await telegramClient.sendFile('me', {
            file: new CustomFile(uploadFile.originalname, uploadFile.size, uploadFile.path),
            caption: `[Ayxa Shared Space:${id}] ${uploadFile.originalname}`,
            workers: 4,
        });

        const messageId = Number(uploadedMessage?.id || 0);
        const fileId = uploadedMessage?.document?.id
            ? String(uploadedMessage.document.id)
            : uploadedMessage?.photo?.id
                ? String(uploadedMessage.photo.id)
                : null;

        if (!messageId) {
            throw new Error('Telegram upload did not return a message id.');
        }

        const insertRes = await pool.query(
            `INSERT INTO shared_files (space_id, telegram_message_id, telegram_file_id, file_name, file_size, mime_type, uploaded_by, folder_path)
             VALUES ($1, $2, $3, $4, $5, $6, NULL, $7)
             RETURNING id, space_id, file_name, file_size, mime_type, created_at, folder_path`,
            [id, messageId, fileId, uploadFile.originalname, uploadFile.size, uploadFile.mimetype, folderPath]
        );

        await writeAccessLog(id, req, 'upload_file');
        return res.status(201).json({ success: true, file: insertRes.rows[0] });
    } catch (err: any) {
        return res.status(500).json({ success: false, error: err.message });
    } finally {
        try {
            if (uploadFile?.path && fs.existsSync(uploadFile.path)) fs.unlinkSync(uploadFile.path);
        } catch {
            // best effort
        }
    }
};

export const downloadSharedSpaceFile = async (req: Request, res: Response) => {
    const id = String(req.params.id || '');
    const sig = String(req.query.sig || '');
    if (!sig) return res.status(401).json({ success: false, error: 'Missing signed token.' });

    const verify = verifyDownloadToken(sig, id);
    if (!verify.valid || !verify.spaceId) {
        return res.status(401).json({ success: false, error: 'Invalid or expired signed token.' });
    }

    const spaceId = verify.spaceId;
    try {
        const space = await requireSpaceAccess(req, res, spaceId);
        if (!space) return;
        if (!space.allow_download) {
            return res.status(403).json({ success: false, error: 'Downloads are disabled for this space.' });
        }

        const fileRes = await pool.query(
            'SELECT id, space_id, telegram_message_id, file_name, mime_type FROM shared_files WHERE id = $1 AND space_id = $2',
            [id, spaceId]
        );
        if (fileRes.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'File not found in this space.' });
        }
        const file = fileRes.rows[0];

        const ownerRes = await pool.query(
            `SELECT u.session_string
             FROM shared_spaces s
             JOIN users u ON u.id = s.owner_id
             WHERE s.id = $1`,
            [spaceId]
        );
        if (ownerRes.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Space owner session unavailable.' });
        }

        const sessionString = String(ownerRes.rows[0].session_string);
        const telegramClient = await getDynamicClient(sessionString);
        const messages = await telegramClient.getMessages('me', { ids: Number(file.telegram_message_id) });
        if (!messages || messages.length === 0) {
            return res.status(404).json({ success: false, error: 'Telegram message not found.' });
        }

        const tmpPath = path.join(TMP_DOWNLOAD_DIR, `${spaceId}_${id}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}.bin`);
        const resultPath = await telegramClient.downloadMedia(messages[0] as any, { outputFile: tmpPath } as any);
        const diskPath = typeof resultPath === 'string' ? resultPath : tmpPath;
        if (!fs.existsSync(diskPath)) {
            return res.status(500).json({ success: false, error: 'Could not stream file from Telegram.' });
        }

        await writeAccessLog(spaceId, req, 'download_file');

        res.setHeader('Content-Type', file.mime_type || 'application/octet-stream');
        res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(file.file_name)}"`);
        const readStream = fs.createReadStream(diskPath);
        readStream.on('close', () => {
            try { fs.unlinkSync(diskPath); } catch { }
        });
        readStream.on('error', () => {
            try { fs.unlinkSync(diskPath); } catch { }
        });
        res.on('close', () => {
            try { fs.unlinkSync(diskPath); } catch { }
        });
        return readStream.pipe(res);
    } catch (err: any) {
        return res.status(500).json({ success: false, error: err.message });
    }
};
