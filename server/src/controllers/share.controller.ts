import { Request, Response } from 'express';
import { AuthRequest } from '../middlewares/auth.middleware';
import pool from '../config/db';
import bcrypt from 'bcryptjs';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { getDynamicClient } from '../services/telegram.service';
import {
    ShareRow,
    buildBreadcrumbs,
    getShareSort,
    getShareUrl,
    isShareExpired,
    normalizeSharePath,
    readShareAccessToken,
    signShareAccessToken,
    signShareLinkToken,
    toDisplaySharePath,
    verifyShareAccessToken,
    verifyShareLinkToken,
} from '../services/share.service';
import { iterFileDownload } from '../services/telegram.service';

const SHARE_TMP_DIR = path.join(os.tmpdir(), 'axya_share_tmp');
const MAX_SHARE_DEPTH = 32;
const DEFAULT_FILE_PAGE_SIZE = 40;
const MAX_FILE_PAGE_SIZE = 50;
const DEFAULT_SHARE_EXPIRY_HOURS = 5 * 24;

try {
    fs.mkdirSync(SHARE_TMP_DIR, { recursive: true });
} catch {
    // best effort
}

const safeUnlink = (targetPath: string) => {
    try {
        if (fs.existsSync(targetPath)) fs.unlinkSync(targetPath);
    } catch {
        // best effort
    }
};

const parseOptionalExpiry = (hours: unknown): Date | null => {
    if (hours === null || hours === undefined || hours === '') return null;
    const parsed = Number.parseInt(String(hours), 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return new Date(NaN);
    return new Date(Date.now() + parsed * 60 * 60 * 1000);
};

const getShareById = async (shareId: string): Promise<ShareRow | null> => {
    const result = await pool.query(
        `SELECT
            s.id,
            s.file_id,
            s.folder_id,
            s.created_by,
            s.password_hash,
            s.expires_at,
            s.allow_download,
            s.view_only,
            s.created_at,
            s.token,
            fo.name AS folder_name,
            fi.file_name
         FROM shared_links s
         LEFT JOIN folders fo ON fo.id = s.folder_id
         LEFT JOIN files fi ON fi.id = s.file_id
         WHERE s.id = $1`,
        [shareId]
    );
    return (result.rows[0] as ShareRow | undefined) || null;
};

const verifyLinkAgainstShare = (share: ShareRow, token: string): boolean => {
    if (share.token && token === share.token) return true;
    const payload = verifyShareLinkToken(token);
    if (!payload) return false;
    return payload.shareId === share.id && payload.folderId === share.folder_id && payload.fileId === share.file_id;
};

const resolveAuthorizedShare = async (req: Request, res: Response): Promise<ShareRow | null> => {
    const accessToken = readShareAccessToken(req);
    if (!accessToken) {
        res.status(401).json({ success: false, error: 'Access token required.' });
        return null;
    }

    const payload = verifyShareAccessToken(accessToken);
    if (!payload) {
        res.status(401).json({ success: false, error: 'Invalid access token.' });
        return null;
    }

    const share = await getShareById(payload.shareId);
    if (!share) {
        res.status(404).json({ success: false, error: 'Share not found.' });
        return null;
    }
    if (isShareExpired(share.expires_at)) {
        res.status(410).json({ success: false, error: 'Link expired.' });
        return null;
    }
    if (share.folder_id !== payload.folderId || share.file_id !== payload.fileId) {
        res.status(401).json({ success: false, error: 'Invalid access token.' });
        return null;
    }

    return share;
};

const getFolderMeta = async (share: ShareRow) => {
    const result = await pool.query(
        `WITH RECURSIVE folder_tree AS (
            SELECT id
            FROM folders
            WHERE id = $1 AND user_id = $2 AND is_trashed = false
            UNION ALL
            SELECT f.id
            FROM folders f
            INNER JOIN folder_tree ft ON f.parent_id = ft.id
            WHERE f.user_id = $2 AND f.is_trashed = false
        )
        SELECT
            fo.name AS folder_name,
            COALESCE(NULLIF(u.name, ''), NULLIF(u.username, ''), u.phone, 'AYXA User') AS owner_name,
            COUNT(fi.id)::int AS file_count
        FROM folders fo
        JOIN users u ON u.id = $2
        LEFT JOIN folder_tree ft ON TRUE
        LEFT JOIN files fi ON fi.folder_id = ft.id AND fi.user_id = $2 AND fi.is_trashed = false
        WHERE fo.id = $1
        GROUP BY fo.name, owner_name`,
        [share.folder_id, share.created_by]
    );
    return result.rows[0] || null;
};

const getFileMeta = async (share: ShareRow) => {
    const result = await pool.query(
        `SELECT
            fi.file_name,
            COALESCE(NULLIF(u.name, ''), NULLIF(u.username, ''), u.phone, 'AYXA User') AS owner_name
         FROM files fi
         JOIN users u ON u.id = $2
         WHERE fi.id = $1 AND fi.user_id = $2 AND fi.is_trashed = false`,
        [share.file_id, share.created_by]
    );
    return result.rows[0] || null;
};

const shareTreeCte = `
    WITH RECURSIVE share_tree AS (
        SELECT id, parent_id, name, ''::text AS relative_path
        FROM folders
        WHERE id = $1 AND user_id = $2 AND is_trashed = false
        UNION ALL
        SELECT f.id, f.parent_id, f.name,
               CASE
                   WHEN st.relative_path = '' THEN f.name
                   ELSE st.relative_path || '/' || f.name
               END AS relative_path
        FROM folders f
        INNER JOIN share_tree st ON f.parent_id = st.id
        WHERE f.user_id = $2 AND f.is_trashed = false AND array_length(string_to_array(st.relative_path, '/'), 1) < $3
    )
`;

const buildShareMetaPayload = async (share: ShareRow) => {
    if (share.folder_id) {
        const meta = await getFolderMeta(share);
        return {
            id: share.id,
            type: 'folder',
            folderId: share.folder_id,
            folderName: meta?.folder_name || share.folder_name || 'Shared Folder',
            owner: meta?.owner_name || 'AYXA User',
            fileCount: Number(meta?.file_count || 0),
            requiresPassword: Boolean(share.password_hash),
            allowDownload: Boolean(share.allow_download),
            viewOnly: Boolean(share.view_only),
            dateShared: share.created_at,
            expiresAt: share.expires_at,
        };
    }

    const meta = await getFileMeta(share);
    return {
        id: share.id,
        type: 'file',
        fileId: share.file_id,
        folderName: meta?.file_name || share.file_name || 'Shared File',
        owner: meta?.owner_name || 'AYXA User',
        fileCount: 1,
        requiresPassword: Boolean(share.password_hash),
        allowDownload: Boolean(share.allow_download),
        viewOnly: Boolean(share.view_only),
        dateShared: share.created_at,
        expiresAt: share.expires_at,
    };
};

export const createShareLink = async (req: AuthRequest, res: Response) => {
    if (!req.user) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const folderId = req.body?.folder_id ? String(req.body.folder_id) : null;
    const fileId = req.body?.file_id ? String(req.body.file_id) : null;
    const password = String(req.body?.password || '').trim();
    const expiresAt = parseOptionalExpiry(req.body?.expires_in_hours ?? DEFAULT_SHARE_EXPIRY_HOURS);
    const allowDownload = req.body?.allow_download !== false;
    const viewOnly = req.body?.view_only === true;

    if ((folderId && fileId) || (!folderId && !fileId)) {
        return res.status(400).json({ success: false, error: 'Provide either folder_id or file_id.' });
    }
    if (expiresAt && Number.isNaN(expiresAt.getTime())) {
        return res.status(400).json({ success: false, error: 'Invalid expiry value.' });
    }

    try {
        if (folderId) {
            const folderCheck = await pool.query(
                'SELECT id FROM folders WHERE id = $1 AND user_id = $2 AND is_trashed = false',
                [folderId, req.user.id]
            );
            if (folderCheck.rows.length === 0) {
                return res.status(404).json({ success: false, error: 'Folder not found.' });
            }
        } else if (fileId) {
            const fileCheck = await pool.query(
                'SELECT id FROM files WHERE id = $1 AND user_id = $2 AND is_trashed = false',
                [fileId, req.user.id]
            );
            if (fileCheck.rows.length === 0) {
                return res.status(404).json({ success: false, error: 'File not found.' });
            }
        }

        const passwordHash = password ? await bcrypt.hash(password, 12) : null;
        const result = await pool.query(
            `INSERT INTO shared_links (folder_id, file_id, password_hash, expires_at, created_by, allow_download, view_only)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             RETURNING id, folder_id, file_id, expires_at, created_at, allow_download, view_only, token`,
            [folderId, fileId, passwordHash, expiresAt, req.user.id, allowDownload, viewOnly]
        );

        const share = result.rows[0] as ShareRow;
        const linkToken = share.token || signShareLinkToken(share, share.expires_at);
        const shareUrl = getShareUrl(share.id, linkToken, req);

        return res.status(201).json({
            success: true,
            shareId: share.id,
            token: linkToken,
            share_url: shareUrl,
            shareUrl,
            expires_at: share.expires_at,
        });
    } catch {
        return res.status(500).json({ success: false, error: 'Server error.' });
    }
};

export const listUserShares = async (req: AuthRequest, res: Response) => {
    if (!req.user) return res.status(401).json({ success: false, error: 'Unauthorized' });

    try {
        const result = await pool.query(
            `SELECT
                s.id,
                s.file_id,
                s.folder_id,
                s.created_at,
                s.expires_at,
                s.allow_download,
                s.view_only,
                s.password_hash IS NOT NULL AS requires_password,
                s.views,
                s.download_count,
                s.token,
                fo.name AS folder_name,
                fi.file_name
             FROM shared_links s
             LEFT JOIN folders fo ON fo.id = s.folder_id
             LEFT JOIN files fi ON fi.id = s.file_id
             WHERE s.created_by = $1
             ORDER BY s.created_at DESC`,
            [req.user.id]
        );

        const shares = result.rows.map((row: any) => {
            const token = row.token || signShareLinkToken(row as ShareRow, row.expires_at);
            return {
                ...row,
                share_url: getShareUrl(row.id, token, req),
                shareUrl: getShareUrl(row.id, token, req),
                token,
            };
        });

        return res.json({ success: true, links: shares, shares });
    } catch {
        return res.status(500).json({ success: false, error: 'Server error.' });
    }
};

export const revokeShareLink = async (req: AuthRequest, res: Response) => {
    if (!req.user) return res.status(401).json({ success: false, error: 'Unauthorized' });
    const shareId = String(req.params.id || '');

    try {
        const result = await pool.query(
            'DELETE FROM shared_links WHERE id = $1 AND created_by = $2 RETURNING id',
            [shareId, req.user.id]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Share not found.' });
        }
        return res.json({ success: true });
    } catch {
        return res.status(500).json({ success: false, error: 'Server error.' });
    }
};

export const getShareSession = async (req: Request, res: Response) => {
    const shareId = String(req.params.shareId || '');
    const token = String(req.query.token || '');

    if (!shareId || !token) {
        return res.status(401).json({ success: false, error: 'Signed link token required.' });
    }

    try {
        const share = await getShareById(shareId);
        if (!share) return res.status(404).json({ success: false, error: 'Share not found.' });
        if (isShareExpired(share.expires_at)) return res.status(410).json({ success: false, error: 'Link expired.' });
        if (!verifyLinkAgainstShare(share, token)) {
            return res.status(401).json({ success: false, error: 'Invalid signed link.' });
        }

        await pool.query('UPDATE shared_links SET views = views + 1 WHERE id = $1', [shareId]).catch(() => undefined);

        const shareMeta = await buildShareMetaPayload(share);
        if (share.password_hash) {
            return res.json({ success: true, share: { ...shareMeta, hasAccess: false } });
        }

        const accessToken = signShareAccessToken(share);
        return res.json({
            success: true,
            share: { ...shareMeta, hasAccess: true },
            accessToken,
        });
    } catch {
        return res.status(500).json({ success: false, error: 'Server error.' });
    }
};

export const verifySharePassword = async (req: Request, res: Response) => {
    const shareId = String(req.body?.shareId || req.body?.share_id || '');
    const password = String(req.body?.password || '');

    if (!shareId) {
        return res.status(400).json({ success: false, error: 'shareId is required.' });
    }
    if (!password) {
        return res.status(400).json({ success: false, error: 'Password is required.' });
    }

    try {
        const share = await getShareById(shareId);
        if (!share) return res.status(404).json({ success: false, error: 'Share not found.' });
        if (isShareExpired(share.expires_at)) return res.status(410).json({ success: false, error: 'Link expired.' });
        if (!share.password_hash) {
            return res.json({ success: true, accessToken: signShareAccessToken(share) });
        }

        const ok = await bcrypt.compare(password, share.password_hash).catch(() => false);
        if (!ok) {
            return res.status(401).json({ success: false, error: 'Incorrect password.' });
        }

        return res.json({
            success: true,
            accessToken: signShareAccessToken(share),
        });
    } catch {
        return res.status(500).json({ success: false, error: 'Server error.' });
    }
};

export const getShareFiles = async (req: Request, res: Response) => {
    const share = await resolveAuthorizedShare(req, res);
    if (!share) return;

    const requestedPath = normalizeSharePath(req.query.path);
    const limit = Math.min(MAX_FILE_PAGE_SIZE, Math.max(1, Number.parseInt(String(req.query.limit || DEFAULT_FILE_PAGE_SIZE), 10) || DEFAULT_FILE_PAGE_SIZE));
    const offset = Math.max(0, Number.parseInt(String(req.query.offset || 0), 10) || 0);
    const search = String(req.query.search || '').trim();
    const { column, direction } = getShareSort(req.query.sortBy, req.query.order);

    try {
        if (share.file_id) {
            const fileRes = await pool.query(
                `SELECT id, file_name, file_size, mime_type, created_at
                 FROM files
                 WHERE id = $1 AND user_id = $2 AND is_trashed = false`,
                [share.file_id, share.created_by]
            );
            if (fileRes.rows.length === 0) {
                return res.status(404).json({ success: false, error: 'File not found.' });
            }

            const file = fileRes.rows[0];
            const includeFile = requestedPath === '' && (!search || String(file.file_name).toLowerCase().includes(search.toLowerCase()));

            return res.json({
                success: true,
                share: await buildShareMetaPayload(share),
                path: '/',
                breadcrumbs: [{ label: 'Root', path: '/' }],
                folders: [],
                files: includeFile ? [file] : [],
                page: {
                    offset: 0,
                    limit,
                    total: includeFile ? 1 : 0,
                    hasMore: false,
                },
            });
        }

        const pathLike = requestedPath ? `${requestedPath}/%` : '';
        const searchLike = `%${search.replace(/[%_]/g, '\\$&')}%`;

        const folderExistsRes = await pool.query(
            `${shareTreeCte}
             SELECT id
             FROM share_tree
             WHERE relative_path = $4`,
            [share.folder_id, share.created_by, MAX_SHARE_DEPTH, requestedPath]
        );
        if (requestedPath && folderExistsRes.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Folder not found in this share.' });
        }

        const foldersRes = await pool.query(
            `${shareTreeCte}
             SELECT
                st.id,
                st.name,
                st.relative_path,
                (
                    SELECT COUNT(*)::int
                    FROM files fi
                    JOIN share_tree desc_st ON desc_st.id = fi.folder_id
                    WHERE fi.user_id = $2
                      AND fi.is_trashed = false
                      AND (desc_st.relative_path = st.relative_path OR desc_st.relative_path LIKE st.relative_path || '/%')
                ) AS file_count,
                (
                    SELECT COUNT(*)::int
                    FROM files fi
                    JOIN share_tree desc_st ON desc_st.id = fi.folder_id
                    WHERE fi.user_id = $2
                      AND fi.is_trashed = false
                      AND fi.mime_type LIKE 'image/%'
                      AND (desc_st.relative_path = st.relative_path OR desc_st.relative_path LIKE st.relative_path || '/%')
                ) AS image_count
             FROM share_tree st
             WHERE (
                $4 = '' AND st.relative_path <> '' AND strpos(st.relative_path, '/') = 0
             ) OR (
                $4 <> ''
                AND st.relative_path LIKE $5
                AND substring(st.relative_path from char_length($4) + 2) <> ''
                AND strpos(substring(st.relative_path from char_length($4) + 2), '/') = 0
             )
             ORDER BY st.name ASC`,
            [share.folder_id, share.created_by, MAX_SHARE_DEPTH, requestedPath, pathLike]
        );

        const filesRes = await pool.query(
            `${shareTreeCte}
             , visible_files AS (
                SELECT
                    fi.id,
                    fi.file_name,
                    fi.file_size,
                    fi.mime_type,
                    fi.created_at,
                    st.relative_path
                FROM files fi
                JOIN share_tree st ON st.id = fi.folder_id
                WHERE fi.user_id = $2
                  AND fi.is_trashed = false
                  AND (
                    CASE
                        WHEN $6 <> '' THEN fi.file_name ILIKE $7 ESCAPE '\\'
                        ELSE st.relative_path = $4
                    END
                  )
             )
             SELECT *, COUNT(*) OVER()::int AS total_count
             FROM visible_files
             ORDER BY ${column} ${direction}, id ASC
             LIMIT $8 OFFSET $9`,
            [share.folder_id, share.created_by, MAX_SHARE_DEPTH, requestedPath, pathLike, search, searchLike, limit, offset]
        );

        const total = Number(filesRes.rows[0]?.total_count || 0);

        return res.json({
            success: true,
            share: await buildShareMetaPayload(share),
            path: toDisplaySharePath(requestedPath),
            breadcrumbs: buildBreadcrumbs(requestedPath),
            folders: foldersRes.rows.map((row: any) => ({
                id: row.id,
                name: row.name,
                path: toDisplaySharePath(row.relative_path),
                fileCount: Number(row.file_count || 0),
                imageCount: Number(row.image_count || 0),
            })),
            files: filesRes.rows.map(({ total_count, ...row }: any) => row),
            page: {
                offset,
                limit,
                total,
                hasMore: offset + filesRes.rows.length < total,
            },
        });
    } catch {
        return res.status(500).json({ success: false, error: 'Server error.' });
    }
};

export const downloadSharedFile = async (req: Request, res: Response) => {
    const share = await resolveAuthorizedShare(req, res);
    if (!share) return;

    const requestedFileId = String(req.params.fileId || '');
    const disposition = String(req.query.disposition || 'attachment').toLowerCase() === 'inline' ? 'inline' : 'attachment';

    try {
        const fileRes = share.file_id
            ? await pool.query(
                `SELECT id, file_name, file_size, mime_type, telegram_message_id, telegram_chat_id
                 FROM files
                 WHERE id = $1 AND user_id = $2 AND is_trashed = false`,
                [share.file_id, share.created_by]
            )
            : await pool.query(
                `${shareTreeCte}
                 SELECT fi.id, fi.file_name, fi.file_size, fi.mime_type, fi.telegram_message_id, fi.telegram_chat_id
                 FROM files fi
                 JOIN share_tree st ON st.id = fi.folder_id
                 WHERE fi.id = $4
                   AND fi.user_id = $2
                   AND fi.is_trashed = false`,
                [share.folder_id, share.created_by, MAX_SHARE_DEPTH, requestedFileId]
            );

        if (fileRes.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'File not found.' });
        }
        if (!share.allow_download && disposition !== 'inline') {
            return res.status(403).json({ success: false, error: 'Downloads are disabled for this share.' });
        }
        if (share.view_only && disposition !== 'inline') {
            return res.status(403).json({ success: false, error: 'View only mode is enabled.' });
        }

        const file = fileRes.rows[0];
        const ownerRes = await pool.query('SELECT session_string FROM users WHERE id = $1', [share.created_by]);
        if (ownerRes.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Share owner session unavailable.' });
        }

        const client = await getDynamicClient(String(ownerRes.rows[0].session_string));
        const messages = await client.getMessages(file.telegram_chat_id, { ids: Number(file.telegram_message_id) });
        if (!messages || messages.length === 0) {
            return res.status(404).json({ success: false, error: 'File no longer available.' });
        }

        if (disposition === 'attachment') {
            await pool.query('UPDATE shared_links SET download_count = download_count + 1 WHERE id = $1', [share.id]).catch(() => undefined);
        }

        // Handle standard Range requests
        const reqRange = req.headers.range;
        const totalSize = Number(file.file_size) || 0; // Ensure file size is mapped or dynamically fetched

        let offset = 0;
        let limit = Infinity;

        if (reqRange) {
            const parts = reqRange.replace(/bytes=/, '').split('-');
            offset = parseInt(parts[0], 10);
            const end = parts[1] ? parseInt(parts[1], 10) : totalSize - 1;
            limit = end - offset + 1;

            res.status(206);
            res.setHeader('Content-Range', `bytes ${offset}-${end}/${totalSize}`);
            res.setHeader('Accept-Ranges', 'bytes');
            res.setHeader('Content-Length', limit.toString());
        }

        res.setHeader('Content-Type', file.mime_type || 'application/octet-stream');
        res.setHeader('Content-Disposition', `${disposition}; filename="${encodeURIComponent(file.file_name)}"`);

        const streamer = iterFileDownload(client, messages[0] as any, offset, limit);

        req.on('close', () => {
            // Request aborted by client
            res.end();
        });

        for await (const chunk of streamer) {
            if (!res.write(chunk)) {
                // Backpressure handling — wait for client to catch up
                await new Promise(resolve => res.once('drain', resolve));
            }
        }
        res.end();

    } catch (e: any) {
        return res.status(500).json({ success: false, error: e.message || 'Server error.' });
    }
};
