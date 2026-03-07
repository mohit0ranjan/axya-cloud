import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import sharp from 'sharp';
import crypto from 'crypto';
import archiver from 'archiver';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { Readable } from 'stream';
import { PoolClient } from 'pg';
import pool from '../config/db';
import { AuthRequest } from '../middlewares/auth.middleware';
import { ShareItemV2Row, ShareLinkV2Row, ShareMetaV2 } from '../models/share-v2.model';
import {
    constantTimeEqualsHex,
    generateLinkSecret,
    generateSlug,
    getSessionTtlSeconds,
    hashLinkSecret,
    hashSessionToken,
    signShareV2SessionToken,
    signShareV2Ticket,
    verifyShareV2SessionToken,
    verifyShareV2Ticket,
} from '../services/share-v2/token.service';
import { rebuildShareSnapshot } from '../services/share-v2/snapshot.service';
import { logShareV2Event } from '../services/share-v2/events.service';
import { resolveTelegramMessageForShareItem } from '../services/share-v2/telegram-read.service';
import { iterFileDownload } from '../services/telegram.service';
import { sendApiError } from '../utils/apiError';
import { FRONTEND_BASE_URL } from '../config/urls';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const isUuid = (v: string): boolean => UUID_REGEX.test(v);
const isInvalidUuidDbError = (err: unknown): boolean => {
    if (!err || typeof err !== 'object') return false;
    return (err as { code?: string }).code === '22P02';
};
const isUniqueViolation = (err: unknown): boolean => {
    if (!err || typeof err !== 'object') return false;
    return (err as { code?: string }).code === '23505';
};

const sanitizeDownloadName = (value: unknown, fallback: string): string => {
    const raw = String(value || '').trim();
    const normalized = raw.replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, ' ').trim();
    return normalized || fallback;
};
const buildContentDisposition = (disposition: 'inline' | 'attachment' | 'thumbnail', fileName: string): string => {
    const safeAscii = fileName.replace(/[^\x20-\x7E]/g, '_').replace(/"/g, '\\"');
    const headerDisp = disposition === 'thumbnail' ? 'inline' : disposition;
    return `${headerDisp}; filename="${safeAscii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
};

const deriveShareBaseUrlFromRequest = (_req: Request): string => {
    return FRONTEND_BASE_URL;
};

const isShareExpired = (expiresAt: string | Date | null): boolean => {
    if (!expiresAt) return false;
    return new Date(expiresAt).getTime() < Date.now();
};

const normalizeSnapshotPath = (value: unknown): string => {
    const raw = String(value || '').trim();
    if (!raw || raw === '/') return '';
    return raw
        .replace(/\\/g, '/')
        .replace(/\/+/g, '/')
        .replace(/\/+$/g, '')
        .replace(/^\//, '')
        .replace(/\.\./g, '');
};

const toDisplayPath = (path: string): string => (path ? `/${path}` : '/');
const ZIP_TMP_DIR = path.join(os.tmpdir(), 'axya_share_v2_zip');
const SYNC_ZIP_MAX_FILES = Number.parseInt(String(process.env.SHARE_V2_SYNC_ZIP_MAX_FILES || '40'), 10) || 40;
const SYNC_ZIP_MAX_BYTES = Number.parseInt(String(process.env.SHARE_V2_SYNC_ZIP_MAX_BYTES || String(200 * 1024 * 1024)), 10) || 200 * 1024 * 1024;
const ZIP_JOB_TTL_HOURS = Number.parseInt(String(process.env.SHARE_V2_ZIP_JOB_TTL_HOURS || '2'), 10) || 2;

try {
    fs.mkdirSync(ZIP_TMP_DIR, { recursive: true });
} catch {
    // best effort
}

const encodeCursor = (offset: number): string => Buffer.from(String(Math.max(0, offset)), 'utf8').toString('base64url');
const decodeCursor = (cursor: unknown): number => {
    const raw = String(cursor || '').trim();
    if (!raw) return 0;
    try {
        const value = Number.parseInt(Buffer.from(raw, 'base64url').toString('utf8'), 10);
        if (!Number.isFinite(value) || value < 0) return 0;
        return value;
    } catch {
        return 0;
    }
};

const getShareByIdForOwner = async (shareId: string, ownerUserId: string): Promise<ShareLinkV2Row | null> => {
    const res = await pool.query(
        `SELECT *
         FROM share_links_v2
         WHERE id = $1 AND owner_user_id = $2`,
        [shareId, ownerUserId]
    );
    return (res.rows[0] as ShareLinkV2Row | undefined) || null;
};

const getShareBySlug = async (slug: string): Promise<ShareLinkV2Row | null> => {
    const res = await pool.query('SELECT * FROM share_links_v2 WHERE slug = $1', [slug]);
    return (res.rows[0] as ShareLinkV2Row | undefined) || null;
};

const getShareByIdForPublic = async (shareId: string): Promise<ShareLinkV2Row | null> => {
    const res = await pool.query('SELECT * FROM share_links_v2 WHERE id = $1', [shareId]);
    return (res.rows[0] as ShareLinkV2Row | undefined) || null;
};

const buildShareMeta = async (share: ShareLinkV2Row): Promise<ShareMetaV2> => {
    const countRes = await pool.query('SELECT COUNT(*)::int AS file_count FROM share_items_v2 WHERE share_id = $1', [share.id]);
    return {
        id: share.id,
        slug: share.slug,
        resourceType: share.resource_type,
        allowDownload: Boolean(share.allow_download),
        allowPreview: Boolean(share.allow_preview),
        requiresPassword: Boolean(share.password_hash),
        expiresAt: share.expires_at,
        revokedAt: share.revoked_at,
        fileCount: Number(countRes.rows[0]?.file_count || 0),
    };
};

const readShareSessionToken = (req: Request): string => {
    const header = String(req.headers.authorization || '');
    if (header.startsWith('Bearer ')) return header.slice('Bearer '.length).trim();
    return String(req.query.session_token || req.query.sessionToken || '').trim();
};

const resolvePublicSession = async (req: Request, res: Response): Promise<{ share: ShareLinkV2Row } | null> => {
    const token = readShareSessionToken(req);
    if (!token) {
        sendApiError(res, 401, 'unauthorized', 'Share session token required.', { retryable: false });
        return null;
    }

    const payload = verifyShareV2SessionToken(token);
    if (!payload) {
        sendApiError(res, 401, 'unauthorized', 'Invalid share session token.', { retryable: false });
        return null;
    }

    const sessionHash = hashSessionToken(token);
    const sessionRes = await pool.query(
        `SELECT id
         FROM share_access_sessions_v2
         WHERE id = $1
           AND share_id = $2
           AND session_token_hash = $3
           AND revoked_at IS NULL
           AND expires_at > NOW()`,
        [payload.sid, payload.shareId, sessionHash]
    );
    if (sessionRes.rowCount === 0) {
        sendApiError(res, 401, 'unauthorized', 'Expired or revoked share session.', { retryable: false });
        return null;
    }

    const share = await getShareByIdForPublic(payload.shareId);
    if (!share) {
        sendApiError(res, 404, 'not_found', 'Share not found.', { retryable: false });
        return null;
    }
    if (share.revoked_at) {
        sendApiError(res, 410, 'not_found', 'Share has been revoked.', { retryable: false });
        return null;
    }
    if (isShareExpired(share.expires_at)) {
        sendApiError(res, 410, 'not_found', 'Share link has expired.', { retryable: false });
        return null;
    }
    const slugParam = String((req.params as any)?.slug || '').trim();
    if (slugParam && slugParam !== share.slug) {
        sendApiError(res, 401, 'unauthorized', 'Share session does not match this link.', { retryable: false });
        return null;
    }

    return { share };
};

const insertShareWithUniqueSlug = async (
    client: PoolClient,
    params: {
        ownerUserId: string;
        resourceType: 'file' | 'folder';
        rootFileId: string | null;
        rootFolderId: string | null;
        linkSecretHash: string;
        passwordHash: string | null;
        allowDownload: boolean;
        allowPreview: boolean;
        expiresAt: Date | null;
    },
): Promise<ShareLinkV2Row> => {
    const attempts = 8;
    let lastErr: unknown = null;

    for (let i = 0; i < attempts; i += 1) {
        const slug = generateSlug();
        try {
            const created = await client.query(
                `INSERT INTO share_links_v2 (
                    owner_user_id, resource_type, root_file_id, root_folder_id, slug,
                    link_secret_hash, password_hash, allow_download, allow_preview, expires_at
                )
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
                RETURNING *`,
                [
                    params.ownerUserId,
                    params.resourceType,
                    params.rootFileId,
                    params.rootFolderId,
                    slug,
                    params.linkSecretHash,
                    params.passwordHash,
                    params.allowDownload,
                    params.allowPreview,
                    params.expiresAt,
                ]
            );
            return created.rows[0] as ShareLinkV2Row;
        } catch (err) {
            lastErr = err;
            if (!isUniqueViolation(err)) throw err;
        }
    }

    throw lastErr || new Error('Failed to generate unique slug');
};

export const createShareV2 = async (req: AuthRequest, res: Response) => {
    if (!req.user) {
        return sendApiError(res, 401, 'unauthorized', 'Unauthorized', { retryable: false });
    }

    const resourceTypeRaw = String(req.body?.resource_type || '').trim().toLowerCase();
    const resourceType = resourceTypeRaw === 'file' || resourceTypeRaw === 'folder' ? resourceTypeRaw : '';
    const rootFileId = String(req.body?.root_file_id || '').trim() || null;
    const rootFolderId = String(req.body?.root_folder_id || '').trim() || null;
    const password = String(req.body?.password || '').trim();
    const allowDownload = req.body?.allow_download !== false;
    const allowPreview = req.body?.allow_preview !== false;
    const expiresRaw = req.body?.expires_at;
    const expiresAt = expiresRaw ? new Date(expiresRaw) : null;

    if (!resourceType) {
        return sendApiError(res, 400, 'invalid_request', 'resource_type must be file or folder.', { retryable: false });
    }
    if ((rootFileId && rootFolderId) || (!rootFileId && !rootFolderId)) {
        return sendApiError(res, 400, 'invalid_request', 'Provide exactly one of root_file_id or root_folder_id.', { retryable: false });
    }
    if (resourceType === 'file' && !rootFileId) {
        return sendApiError(res, 400, 'invalid_request', 'file share requires root_file_id.', { retryable: false });
    }
    if (resourceType === 'folder' && !rootFolderId) {
        return sendApiError(res, 400, 'invalid_request', 'folder share requires root_folder_id.', { retryable: false });
    }
    if (rootFileId && !isUuid(rootFileId)) {
        return sendApiError(res, 400, 'invalid_request', 'Invalid root_file_id.', { retryable: false });
    }
    if (rootFolderId && !isUuid(rootFolderId)) {
        return sendApiError(res, 400, 'invalid_request', 'Invalid root_folder_id.', { retryable: false });
    }
    if (expiresAt && Number.isNaN(expiresAt.getTime())) {
        return sendApiError(res, 400, 'invalid_request', 'Invalid expires_at value.', { retryable: false });
    }

    const linkSecret = generateLinkSecret();
    const linkSecretHash = hashLinkSecret(linkSecret);
    const passwordHash = password ? await bcrypt.hash(password, 12) : null;

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const created = await insertShareWithUniqueSlug(client, {
            ownerUserId: req.user.id,
            resourceType: resourceType as 'file' | 'folder',
            rootFileId,
            rootFolderId,
            linkSecretHash,
            passwordHash,
            allowDownload,
            allowPreview,
            expiresAt,
        });

        await rebuildShareSnapshot(
            client,
            created.id,
            req.user.id,
            created.resource_type,
            created.root_file_id,
            created.root_folder_id,
        );

        await client.query('COMMIT');

        const shareMeta = await buildShareMeta(created);
        const base = deriveShareBaseUrlFromRequest(req);
        const sharePath = `/s/${encodeURIComponent(created.slug)}?k=${encodeURIComponent(linkSecret)}`;

        return res.status(201).json({
            success: true,
            share: shareMeta,
            share_url: `${base}${sharePath}`,
            shareUrl: `${base}${sharePath}`,
            slug: created.slug,
            secret: linkSecret,
        });
    } catch (err) {
        await client.query('ROLLBACK').catch(() => undefined);
        if (isInvalidUuidDbError(err)) {
            return sendApiError(res, 400, 'invalid_request', 'Invalid file or folder id.', { retryable: false });
        }
        return sendApiError(res, 500, 'internal_error', 'Failed to create v2 share.', {
            retryable: false,
            details: process.env.NODE_ENV !== 'production' ? String((err as any)?.message || err) : undefined,
        });
    } finally {
        client.release();
    }
};

export const listSharesV2 = async (req: AuthRequest, res: Response) => {
    if (!req.user) {
        return sendApiError(res, 401, 'unauthorized', 'Unauthorized', { retryable: false });
    }

    try {
        const result = await pool.query(
            `SELECT
                s.*,
                COUNT(si.id)::int AS file_count
             FROM share_links_v2 s
             LEFT JOIN share_items_v2 si ON si.share_id = s.id
             WHERE s.owner_user_id = $1
             GROUP BY s.id
             ORDER BY s.created_at DESC`,
            [req.user.id]
        );

        return res.json({
            success: true,
            shares: result.rows.map((row: any) => ({
                id: row.id,
                slug: row.slug,
                resourceType: row.resource_type,
                allowDownload: Boolean(row.allow_download),
                allowPreview: Boolean(row.allow_preview),
                requiresPassword: Boolean(row.password_hash),
                expiresAt: row.expires_at,
                revokedAt: row.revoked_at,
                fileCount: Number(row.file_count || 0),
                createdAt: row.created_at,
                updatedAt: row.updated_at,
            })),
        });
    } catch {
        return sendApiError(res, 500, 'internal_error', 'Failed to list v2 shares.', { retryable: false });
    }
};

export const patchShareV2 = async (req: AuthRequest, res: Response) => {
    if (!req.user) {
        return sendApiError(res, 401, 'unauthorized', 'Unauthorized', { retryable: false });
    }

    const shareId = String(req.params.id || '');
    if (!isUuid(shareId)) {
        return sendApiError(res, 400, 'invalid_request', 'Invalid share id.', { retryable: false });
    }

    try {
        const share = await getShareByIdForOwner(shareId, req.user.id);
        if (!share) {
            return sendApiError(res, 404, 'not_found', 'Share not found.', { retryable: false });
        }

        const updates: string[] = [];
        const values: any[] = [];
        let idx = 1;

        if (Object.prototype.hasOwnProperty.call(req.body || {}, 'password')) {
            const raw = String(req.body?.password || '').trim();
            const hashed = raw ? await bcrypt.hash(raw, 12) : null;
            updates.push(`password_hash = $${idx++}`);
            values.push(hashed);
        }

        if (Object.prototype.hasOwnProperty.call(req.body || {}, 'expires_at')) {
            const expiresRaw = req.body?.expires_at;
            const expiresAt = expiresRaw ? new Date(expiresRaw) : null;
            if (expiresAt && Number.isNaN(expiresAt.getTime())) {
                return sendApiError(res, 400, 'invalid_request', 'Invalid expires_at value.', { retryable: false });
            }
            updates.push(`expires_at = $${idx++}`);
            values.push(expiresAt);
        }

        if (Object.prototype.hasOwnProperty.call(req.body || {}, 'allow_download')) {
            updates.push(`allow_download = $${idx++}`);
            values.push(req.body?.allow_download !== false);
        }

        if (Object.prototype.hasOwnProperty.call(req.body || {}, 'allow_preview')) {
            updates.push(`allow_preview = $${idx++}`);
            values.push(req.body?.allow_preview !== false);
        }

        if (Object.prototype.hasOwnProperty.call(req.body || {}, 'revoke')) {
            const revoke = Boolean(req.body?.revoke);
            updates.push(`revoked_at = $${idx++}`);
            values.push(revoke ? new Date() : null);
        }

        if (updates.length === 0) {
            const meta = await buildShareMeta(share);
            return res.json({ success: true, share: meta });
        }

        updates.push('updated_at = NOW()');

        values.push(shareId, req.user.id);
        const query = `UPDATE share_links_v2 SET ${updates.join(', ')} WHERE id = $${idx++} AND owner_user_id = $${idx} RETURNING *`;
        const updated = await pool.query(query, values);

        const row = updated.rows[0] as ShareLinkV2Row;
        const meta = await buildShareMeta(row);
        return res.json({ success: true, share: meta });
    } catch {
        return sendApiError(res, 500, 'internal_error', 'Failed to update v2 share.', { retryable: false });
    }
};

export const deleteShareV2 = async (req: AuthRequest, res: Response) => {
    if (!req.user) {
        return sendApiError(res, 401, 'unauthorized', 'Unauthorized', { retryable: false });
    }

    const shareId = String(req.params.id || '');
    if (!isUuid(shareId)) {
        return sendApiError(res, 400, 'invalid_request', 'Invalid share id.', { retryable: false });
    }

    try {
        const result = await pool.query(
            `UPDATE share_links_v2
             SET revoked_at = NOW(), updated_at = NOW()
             WHERE id = $1 AND owner_user_id = $2
             RETURNING id`,
            [shareId, req.user.id]
        );

        if (result.rowCount === 0) {
            return sendApiError(res, 404, 'not_found', 'Share not found.', { retryable: false });
        }

        return res.json({ success: true });
    } catch {
        return sendApiError(res, 500, 'internal_error', 'Failed to delete v2 share.', { retryable: false });
    }
};

export const openPublicShareV2 = async (req: Request, res: Response) => {
    const slug = String(req.params.slug || '').trim();
    const secret = String(req.body?.secret || req.query.k || '').trim();
    const password = String(req.body?.password || '').trim();

    if (!slug || !secret) {
        return sendApiError(res, 400, 'invalid_request', 'slug and secret are required.', { retryable: false });
    }

    try {
        const share = await getShareBySlug(slug);
        if (!share) {
            return sendApiError(res, 404, 'not_found', 'Share not found.', { retryable: false });
        }
        if (share.revoked_at) {
            return sendApiError(res, 410, 'not_found', 'Share has been revoked.', { retryable: false });
        }
        if (isShareExpired(share.expires_at)) {
            return sendApiError(res, 410, 'not_found', 'Share has expired.', { retryable: false });
        }

        const expectedHash = share.link_secret_hash;
        const providedHash = hashLinkSecret(secret);
        if (!constantTimeEqualsHex(expectedHash, providedHash)) {
            await logShareV2Event({
                shareId: share.id,
                eventType: 'error',
                statusCode: 401,
                errorCode: 'invalid_secret',
            });
            return sendApiError(res, 401, 'unauthorized', 'Invalid share secret.', { retryable: false });
        }

        if (share.password_hash) {
            const ok = await bcrypt.compare(password, share.password_hash).catch(() => false);
            if (!ok) {
                await logShareV2Event({
                    shareId: share.id,
                    eventType: 'error',
                    statusCode: 401,
                    errorCode: 'invalid_password',
                });
                return sendApiError(res, 401, 'unauthorized', 'Incorrect share password.', { retryable: false });
            }
        }

        const sessionId = crypto.randomUUID();
        const sessionToken = signShareV2SessionToken({ shareId: share.id, sid: sessionId });
        const sessionTokenHash = hashSessionToken(sessionToken);
        const ttl = getSessionTtlSeconds();
        const expiresAt = new Date(Date.now() + ttl * 1000);

        await pool.query(
            `INSERT INTO share_access_sessions_v2 (id, share_id, session_token_hash, expires_at, ip, user_agent)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [sessionId, share.id, sessionTokenHash, expiresAt, req.ip || null, String(req.headers['user-agent'] || '') || null]
        );

        await logShareV2Event({ shareId: share.id, eventType: 'open', statusCode: 200 });

        return res.json({
            success: true,
            session_token: sessionToken,
            sessionToken,
            share: await buildShareMeta(share),
        });
    } catch {
        return sendApiError(res, 500, 'internal_error', 'Failed to open share.', { retryable: false });
    }
};

export const getPublicShareMetaV2 = async (req: Request, res: Response) => {
    const ctx = await resolvePublicSession(req, res);
    if (!ctx) return;

    return res.json({ success: true, share: await buildShareMeta(ctx.share) });
};

export const listPublicShareItemsV2 = async (req: Request, res: Response) => {
    const ctx = await resolvePublicSession(req, res);
    if (!ctx) return;

    const share = ctx.share;
    const path = normalizeSnapshotPath(req.query.path);
    const search = String(req.query.search || '').trim();
    const limit = Math.min(100, Math.max(1, Number.parseInt(String(req.query.limit || 50), 10) || 50));
    const offsetFromQuery = Math.max(0, Number.parseInt(String(req.query.offset || 0), 10) || 0);
    const offsetFromCursor = decodeCursor(req.query.cursor);
    const offset = req.query.cursor ? offsetFromCursor : offsetFromQuery;
    const sort = String(req.query.sort || 'name_asc').trim().toLowerCase();

    try {
        const whereParts = ['share_id = $1'];
        const values: any[] = [share.id];
        let idx = 2;

        whereParts.push(`relative_path = $${idx++}`);
        values.push(path);

        if (search) {
            whereParts.push(`display_name ILIKE $${idx++} ESCAPE '\\'`);
            values.push(`%${search.replace(/[%_]/g, '\\$&')}%`);
        }

        const sortSql = (() => {
            switch (sort) {
                case 'name_desc': return 'display_name DESC, id DESC';
                case 'size_asc': return 'size_bytes ASC, id ASC';
                case 'size_desc': return 'size_bytes DESC, id DESC';
                case 'date_asc': return 'created_at ASC, id ASC';
                case 'date_desc': return 'created_at DESC, id DESC';
                case 'position_asc': return 'position_index ASC, id ASC';
                case 'position_desc': return 'position_index DESC, id DESC';
                case 'name_asc':
                default:
                    return 'display_name ASC, id ASC';
            }
        })();

        const filesRes = await pool.query(
            `SELECT *, COUNT(*) OVER()::int AS total_count
             FROM share_items_v2
             WHERE ${whereParts.join(' AND ')}
             ORDER BY ${sortSql}
             LIMIT $${idx++} OFFSET $${idx}`,
            [...values, limit, offset]
        );

        const total = Number(filesRes.rows[0]?.total_count || 0);

        const folderRes = path
            ? await pool.query(
                `WITH source AS (
                    SELECT relative_path
                    FROM share_items_v2
                    WHERE share_id = $1
                      AND relative_path LIKE ($2 || '/%')
                )
                SELECT
                    split_part(substring(relative_path FROM char_length($2) + 2), '/', 1) AS name,
                    COUNT(*)::int AS file_count
                FROM source
                WHERE substring(relative_path FROM char_length($2) + 2) <> ''
                GROUP BY name
                ORDER BY name ASC`,
                [share.id, path]
            )
            : await pool.query(
                `SELECT
                    split_part(relative_path, '/', 1) AS name,
                    COUNT(*)::int AS file_count
                FROM share_items_v2
                WHERE share_id = $1
                  AND relative_path <> ''
                GROUP BY name
                ORDER BY name ASC`,
                [share.id]
            );

        return res.json({
            success: true,
            share: await buildShareMeta(share),
            path: toDisplayPath(path),
            folders: folderRes.rows
                .filter((row: any) => String(row.name || '').trim())
                .map((row: any) => ({
                    name: row.name,
                    path: toDisplayPath(path ? `${path}/${row.name}` : row.name),
                    fileCount: Number(row.file_count || 0),
                })),
            files: filesRes.rows.map(({ total_count, ...row }: any) => row),
            page: {
                offset,
                limit,
                total,
                hasMore: offset + filesRes.rows.length < total,
            },
            cursor: {
                next: offset + filesRes.rows.length < total ? encodeCursor(offset + filesRes.rows.length) : null,
                current: encodeCursor(offset),
            },
        });
    } catch {
        return sendApiError(res, 500, 'internal_error', 'Failed to list shared items.', { retryable: false });
    }
};

export const createShareItemTicketV2 = async (req: Request, res: Response) => {
    const ctx = await resolvePublicSession(req, res);
    if (!ctx) return;

    const share = ctx.share;
    const itemId = String(req.params.itemId || '').trim();
    if (!isUuid(itemId)) {
        return sendApiError(res, 400, 'invalid_request', 'Invalid item id.', { retryable: false });
    }

    const reqDisposition = String(req.body?.disposition || req.query.disposition || 'inline').toLowerCase();
    const disposition = reqDisposition === 'attachment'
        ? 'attachment'
        : reqDisposition === 'thumbnail'
            ? 'thumbnail'
            : 'inline';

    if (disposition === 'inline' && !share.allow_preview) {
        return sendApiError(res, 403, 'forbidden', 'Preview is disabled for this share.', { retryable: false });
    }
    if (disposition === 'attachment' && !share.allow_download) {
        return sendApiError(res, 403, 'forbidden', 'Download is disabled for this share.', { retryable: false });
    }

    try {
        const itemRes = await pool.query('SELECT id, size_bytes FROM share_items_v2 WHERE id = $1 AND share_id = $2', [itemId, share.id]);
        if (itemRes.rowCount === 0) {
            return sendApiError(res, 404, 'not_found', 'Shared item not found.', { retryable: false });
        }

        const sizeBytes = Number(itemRes.rows[0].size_bytes || 0);
        if (disposition === 'thumbnail' && sizeBytes > 20 * 1024 * 1024) {
            return sendApiError(res, 400, 'thumbnail_unavailable', 'File is too large for thumbnail generation.', { retryable: false });
        }

        const ticket = signShareV2Ticket({
            shareId: share.id,
            itemId,
            disposition,
        });

        return res.json({
            success: true,
            ticket,
            stream_url: `/api/v2/public/stream/${encodeURIComponent(ticket)}`,
        });
    } catch {
        return sendApiError(res, 500, 'internal_error', 'Failed to issue preview ticket.', { retryable: false });
    }
};

export const streamShareItemV2 = async (req: Request, res: Response) => {
    const ticket = String(req.params.ticket || '').trim();
    const payload = verifyShareV2Ticket(ticket);
    if (!payload) {
        return sendApiError(res, 401, 'unauthorized', 'Invalid or expired stream ticket.', { retryable: false });
    }

    try {
        const shareRes = await pool.query('SELECT * FROM share_links_v2 WHERE id = $1', [payload.shareId]);
        const share = (shareRes.rows[0] as ShareLinkV2Row | undefined) || null;
        if (!share) return sendApiError(res, 404, 'not_found', 'Share not found.', { retryable: false });
        if (share.revoked_at) return sendApiError(res, 410, 'not_found', 'Share revoked.', { retryable: false });
        if (isShareExpired(share.expires_at)) return sendApiError(res, 410, 'not_found', 'Share expired.', { retryable: false });

        if (payload.disposition === 'inline' && !share.allow_preview) {
            return sendApiError(res, 403, 'forbidden', 'Preview is disabled for this share.', { retryable: false });
        }
        if (payload.disposition === 'attachment' && !share.allow_download) {
            return sendApiError(res, 403, 'forbidden', 'Download is disabled for this share.', { retryable: false });
        }

        const itemRes = await pool.query(
            `SELECT *
             FROM share_items_v2
             WHERE id = $1 AND share_id = $2`,
            [payload.itemId, payload.shareId]
        );
        const item = (itemRes.rows[0] as ShareItemV2Row | undefined) || null;
        if (!item) {
            return sendApiError(res, 404, 'not_found', 'Shared item not found.', { retryable: false });
        }

        const chatId = String(item.telegram_chat_id || '').trim();
        const messageId = Number.parseInt(String(item.telegram_message_id || ''), 10);
        if (!chatId || !Number.isFinite(messageId) || messageId <= 0) {
            await logShareV2Event({
                shareId: share.id,
                eventType: 'error',
                itemId: item.id,
                statusCode: 404,
                errorCode: 'telegram_message_missing',
            });
            return sendApiError(res, 404, 'telegram_message_missing', 'File source is unavailable.', { retryable: false });
        }

        const resolved = await resolveTelegramMessageForShareItem(share.owner_user_id, chatId, messageId);
        if ('failure' in resolved) {
            await logShareV2Event({
                shareId: share.id,
                eventType: 'error',
                itemId: item.id,
                statusCode: resolved.failure.status,
                errorCode: resolved.failure.code,
            });
            return sendApiError(res, resolved.failure.status, resolved.failure.code, resolved.failure.message, {
                retryable: resolved.failure.retryable,
            });
        }

        const totalSize = Number(item.size_bytes || 0);
        const reqRange = String(req.headers.range || '');

        let offset = 0;
        let limit = Infinity;

        if (reqRange && totalSize > 0 && /^bytes=\d*-\d*$/.test(reqRange)) {
            const parts = reqRange.replace('bytes=', '').split('-');
            const start = Number.parseInt(parts[0], 10);
            const end = parts[1] ? Number.parseInt(parts[1], 10) : totalSize - 1;
            if (Number.isFinite(start) && Number.isFinite(end) && start >= 0 && end >= start) {
                offset = start;
                limit = Math.max(1, end - start + 1);
                res.status(206);
                res.setHeader('Content-Range', `bytes ${start}-${Math.min(end, totalSize - 1)}/${totalSize}`);
                res.setHeader('Accept-Ranges', 'bytes');
                res.setHeader('Content-Length', String(Math.min(limit, Math.max(totalSize - start, 0))));
            }
        }

        const mimeType = item.mime_type || 'application/octet-stream';
        const resolvedFileName = sanitizeDownloadName(item.display_name, 'file');
        const weakEtag = `W/"${item.id}:${item.size_bytes}:${item.telegram_message_id}"`;
        const lastModified = new Date(item.created_at || Date.now()).toUTCString();
        const ifNoneMatch = String(req.headers['if-none-match'] || '').trim();
        const ifModifiedSince = String(req.headers['if-modified-since'] || '').trim();

        res.setHeader('ETag', weakEtag);
        res.setHeader('Last-Modified', lastModified);

        if (!req.headers.range && (ifNoneMatch === weakEtag || (ifModifiedSince && new Date(ifModifiedSince).getTime() >= new Date(lastModified).getTime()))) {
            return res.status(304).end();
        }

        res.setHeader('Content-Type', mimeType);
        res.setHeader('Content-Disposition', buildContentDisposition(payload.disposition, resolvedFileName));

        if (payload.disposition === 'thumbnail') {
            res.setHeader('Cache-Control', 'public, max-age=86400'); // Cache thumbnails for 24h
        }

        req.socket.setTimeout(5 * 60 * 1000);
        req.socket.on('timeout', () => req.destroy(new Error('stream_timeout')));

        if (payload.disposition === 'attachment') {
            await logShareV2Event({ shareId: share.id, eventType: 'download', itemId: item.id, statusCode: 200 });
        } else {
            await logShareV2Event({ shareId: share.id, eventType: 'preview', itemId: item.id, statusCode: 200 });
        }

        const stream = iterFileDownload(resolved.client, resolved.message as any, offset, limit);
        let clientClosed = false;
        req.on('close', () => {
            clientClosed = true;
            res.end();
        });

        if (payload.disposition === 'thumbnail' && mimeType.startsWith('image/')) {
            const MAX_THUMBNAIL_BYTES = 20 * 1024 * 1024; // 20 MB
            if (totalSize > MAX_THUMBNAIL_BYTES) {
                return sendApiError(res, 400, 'thumbnail_unavailable', 'File too large for thumbnail.', { retryable: false });
            }
            try {
                // Pipe stream through Sharp
                const transformer = sharp({ failOnError: false })
                    .resize(480, 480, { fit: 'inside', withoutEnlargement: true })
                    .toFormat('webp', { quality: 50, effort: 3 });

                // We need to set a different content type for Thumbnails (WebP) and drop Content-Length since Sharp compresses it dynamically
                res.setHeader('Content-Type', 'image/webp');
                res.removeHeader('Content-Length');
                res.removeHeader('Content-Range');
                if (res.statusCode === 206) res.status(200);

                const nodeStream = require('stream').Readable.from(stream);
                nodeStream.pipe(transformer).pipe(res);
                return;
            } catch (sharpErr: any) {
                console.warn(`[Thumbnail Share] Sharp compression failed: ${sharpErr.message}`);
                // Fallback to normal stream below
            }
        }

        for await (const chunk of stream) {
            if (clientClosed) break;
            if (!res.write(chunk)) {
                await new Promise<void>((resolve) => {
                    res.once('drain', resolve);
                    req.once('close', () => resolve());
                });
            }
        }

        if (!clientClosed) res.end();
    } catch (err) {
        if (res.headersSent) {
            req.destroy();
            return;
        }
        return sendApiError(res, 500, 'internal_error', 'Failed to stream shared file.', {
            retryable: true,
            details: process.env.NODE_ENV !== 'production' ? String((err as any)?.message || err) : undefined,
        });
    }
};

const addItemsToArchive = async (share: ShareLinkV2Row, items: ShareItemV2Row[], archive: archiver.Archiver): Promise<number> => {
    let appended = 0;
    for (const row of items) {
        const chatId = String(row.telegram_chat_id || '').trim();
        const messageId = Number.parseInt(String(row.telegram_message_id || ''), 10);
        if (!chatId || !Number.isFinite(messageId) || messageId <= 0) continue;

        const resolved = await resolveTelegramMessageForShareItem(share.owner_user_id, chatId, messageId);
        if ('failure' in resolved) {
            await logShareV2Event({
                shareId: share.id,
                eventType: 'error',
                itemId: row.id,
                statusCode: resolved.failure.status,
                errorCode: resolved.failure.code,
            });
            continue;
        }

        const safeName = String(row.display_name || 'file').replace(/[\\/:*?"<>|]/g, '_');
        const rel = String(row.relative_path || '').replace(/^\//, '').replace(/\\/g, '/');
        const archivePath = rel ? `${rel}/${safeName}` : safeName;
        archive.append(Readable.from(iterFileDownload(resolved.client, resolved.message as any, 0, Infinity)), {
            name: archivePath,
        });
        appended += 1;
    }
    return appended;
};

const runAsyncZipJob = async (jobId: string, share: ShareLinkV2Row, items: ShareItemV2Row[]) => {
    const zipFileName = `${share.slug}-${jobId}.zip`;
    const zipPath = path.join(ZIP_TMP_DIR, zipFileName);
    const tmpPath = `${zipPath}.tmp`;

    await pool.query(
        `UPDATE share_zip_jobs_v2
         SET status = 'running', started_at = NOW()
         WHERE id = $1`,
        [jobId]
    );

    try {
        await new Promise<void>(async (resolve, reject) => {
            const output = fs.createWriteStream(tmpPath, { flags: 'w' });
            const archive = archiver('zip', { zlib: { level: 9 } });
            let ended = false;

            const fail = (err: unknown) => {
                if (ended) return;
                ended = true;
                reject(err);
            };
            const done = () => {
                if (ended) return;
                ended = true;
                resolve();
            };

            output.on('close', done);
            output.on('error', fail);
            archive.on('error', fail);
            archive.pipe(output);

            try {
                const appended = await addItemsToArchive(share, items, archive);
                if (appended === 0) throw new Error('No downloadable files found.');
                await archive.finalize();
            } catch (err) {
                fail(err);
            }
        });

        fs.renameSync(tmpPath, zipPath);
        const stat = fs.statSync(zipPath);
        const expiresAt = new Date(Date.now() + ZIP_JOB_TTL_HOURS * 60 * 60 * 1000);
        await pool.query(
            `UPDATE share_zip_jobs_v2
             SET status = 'completed',
                 completed_at = NOW(),
                 expires_at = $2,
                 zip_path = $3,
                 total_bytes = $4
             WHERE id = $1`,
            [jobId, expiresAt, zipPath, stat.size]
        );
        await logShareV2Event({ shareId: share.id, eventType: 'download_zip', statusCode: 200, meta: { async: true, jobId } });
    } catch (err) {
        try {
            if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
        } catch {
            // best effort
        }
        await pool.query(
            `UPDATE share_zip_jobs_v2
             SET status = 'failed',
                 completed_at = NOW(),
                 error_code = $2,
                 error_message = $3
             WHERE id = $1`,
            [jobId, 'zip_failed', String((err as any)?.message || 'ZIP generation failed')]
        );
    }
};

export const downloadAllShareZipV2 = async (req: Request, res: Response) => {
    const ctx = await resolvePublicSession(req, res);
    if (!ctx) return;

    const share = ctx.share;
    if (!share.allow_download) {
        return sendApiError(res, 403, 'forbidden', 'Download is disabled for this share.', { retryable: false });
    }

    try {
        const rows = await pool.query(
            `SELECT *
             FROM share_items_v2
             WHERE share_id = $1
             ORDER BY position_index ASC, relative_path ASC, display_name ASC`,
            [share.id]
        );
        const items = rows.rows as ShareItemV2Row[];

        if (items.length === 0) {
            return sendApiError(res, 404, 'not_found', 'No files available in this share.', { retryable: false });
        }

        const totalBytes = items.reduce((acc, item) => acc + Number(item.size_bytes || 0), 0);
        const forceAsync = String(req.query.async || '').trim() === '1';
        const shouldAsync = forceAsync || items.length > SYNC_ZIP_MAX_FILES || totalBytes > SYNC_ZIP_MAX_BYTES;

        if (shouldAsync) {
            const created = await pool.query(
                `INSERT INTO share_zip_jobs_v2 (share_id, status, file_count, total_bytes)
                 VALUES ($1, 'pending', $2, $3)
                 RETURNING id`,
                [share.id, items.length, totalBytes]
            );
            const jobId = String(created.rows[0]?.id || '');
            if (!jobId) {
                return sendApiError(res, 500, 'internal_error', 'Failed to create ZIP job.', { retryable: true });
            }

            void runAsyncZipJob(jobId, share, items);
            return res.status(202).json({
                success: true,
                mode: 'async',
                job_id: jobId,
                polling_url: `/api/v2/public/shares/${encodeURIComponent(share.slug)}/zip-jobs/${encodeURIComponent(jobId)}`,
            });
        }

        const safeSlug = share.slug.replace(/[^a-zA-Z0-9_-]/g, '') || 'share';
        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Disposition', buildContentDisposition('attachment', `${safeSlug}.zip`));
        req.socket.setTimeout(10 * 60 * 1000);
        req.socket.on('timeout', () => req.destroy(new Error('zip_stream_timeout')));

        const archive = archiver('zip', { zlib: { level: 9 } });
        archive.on('error', () => {
            if (!res.headersSent) {
                sendApiError(res, 500, 'internal_error', 'Failed to build ZIP.', { retryable: true });
            } else {
                res.end();
            }
        });
        archive.pipe(res);

        const appended = await addItemsToArchive(share, items, archive);
        if (appended === 0) {
            if (!res.headersSent) {
                return sendApiError(res, 404, 'telegram_message_not_found', 'No downloadable files found.', { retryable: false });
            }
            archive.abort();
            return;
        }

        await logShareV2Event({ shareId: share.id, eventType: 'download_zip', statusCode: 200, meta: { fileCount: appended, async: false } });
        await archive.finalize();
    } catch {
        if (res.headersSent) {
            req.destroy();
            return;
        }
        return sendApiError(res, 500, 'internal_error', 'Failed to download ZIP.', { retryable: true });
    }
};

export const getShareZipJobV2 = async (req: Request, res: Response) => {
    const ctx = await resolvePublicSession(req, res);
    if (!ctx) return;

    const share = ctx.share;
    const jobId = String(req.params.jobId || '').trim();
    if (!isUuid(jobId)) {
        return sendApiError(res, 400, 'invalid_request', 'Invalid job id.', { retryable: false });
    }

    const result = await pool.query(
        `SELECT id, status, requested_at, started_at, completed_at, expires_at, file_count, total_bytes, error_code, error_message, zip_path
         FROM share_zip_jobs_v2
         WHERE id = $1 AND share_id = $2`,
        [jobId, share.id]
    );
    if (result.rowCount === 0) {
        return sendApiError(res, 404, 'not_found', 'ZIP job not found.', { retryable: false });
    }

    const row = result.rows[0];
    const isExpired = row.expires_at && new Date(row.expires_at).getTime() < Date.now();
    if (isExpired && row.zip_path) {
        try {
            if (fs.existsSync(String(row.zip_path))) fs.unlinkSync(String(row.zip_path));
        } catch {
            // best effort
        }
        await pool.query(
            `UPDATE share_zip_jobs_v2
             SET status = 'failed', error_code = 'zip_expired', error_message = 'ZIP expired and removed.'
             WHERE id = $1`,
            [jobId]
        );
    }

    const refreshed = await pool.query(
        `SELECT id, status, requested_at, started_at, completed_at, expires_at, file_count, total_bytes, error_code, error_message, zip_path
         FROM share_zip_jobs_v2
         WHERE id = $1`,
        [jobId]
    );
    const current = refreshed.rows[0];

    if (current.status === 'completed' && current.zip_path) {
        const download = String(req.query.download || '').trim() === '1';
        if (download) {
            const zipPath = String(current.zip_path);
            if (!fs.existsSync(zipPath)) {
                return sendApiError(res, 404, 'not_found', 'ZIP file no longer available.', { retryable: false });
            }
            const stat = fs.statSync(zipPath);
            const etag = `W/"zip:${jobId}:${stat.size}"`;
            res.setHeader('Content-Type', 'application/zip');
            res.setHeader('Content-Length', String(stat.size));
            res.setHeader('Content-Disposition', buildContentDisposition('attachment', `${sanitizeDownloadName(share.slug, 'share')}-shared.zip`));
            res.setHeader('ETag', etag);
            res.setHeader('Last-Modified', stat.mtime.toUTCString());
            return fs.createReadStream(zipPath).pipe(res);
        }
    }

    return res.json({
        success: true,
        job: {
            id: current.id,
            status: current.status,
            requested_at: current.requested_at,
            started_at: current.started_at,
            completed_at: current.completed_at,
            expires_at: current.expires_at,
            file_count: Number(current.file_count || 0),
            total_bytes: Number(current.total_bytes || 0),
            error_code: current.error_code || null,
            error_message: current.error_message || null,
            download_url: current.status === 'completed'
                ? `/api/v2/public/shares/${encodeURIComponent(share.slug)}/zip-jobs/${encodeURIComponent(jobId)}?download=1`
                : null,
        },
    });
};
