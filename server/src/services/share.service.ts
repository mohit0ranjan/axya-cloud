import { Request } from 'express';
import jwt from 'jsonwebtoken';

export type ShareRow = {
    id: string;
    file_id: string | null;
    folder_id: string | null;
    created_by: string;
    password_hash: string | null;
    expires_at: string | Date | null;
    allow_download: boolean;
    view_only: boolean;
    created_at: string | Date;
    folder_name?: string | null;
    file_name?: string | null;
};

type ShareLinkPayload = {
    typ: 'share_link';
    shareId: string;
    folderId: string | null;
    fileId: string | null;
};

type ShareAccessPayload = {
    typ: 'share_access';
    shareId: string;
    folderId: string | null;
    fileId: string | null;
};

const SHARE_LINK_SECRET = process.env.SHARE_LINK_SECRET || process.env.JWT_SECRET || 'axya_share_link_secret';
const SHARE_ACCESS_SECRET = process.env.SHARE_ACCESS_SECRET || process.env.JWT_SECRET || 'axya_share_access_secret';
const SHARE_PUBLIC_BASE_URL = (process.env.SHARE_PUBLIC_BASE_URL || process.env.WEB_PUBLIC_BASE_URL || 'http://localhost:3001').replace(/\/+$/, '');
const parseAccessTokenTtlSeconds = (): number => {
    const raw = String(process.env.SHARE_ACCESS_TOKEN_TTL || '').trim();
    if (!raw) return 12 * 60 * 60;

    const numeric = Number.parseInt(raw, 10);
    if (Number.isFinite(numeric) && numeric > 0 && /^\d+$/.test(raw)) {
        return numeric;
    }

    const match = raw.match(/^(\d+)([smhd])$/i);
    if (!match) return 12 * 60 * 60;

    const value = Number.parseInt(match[1], 10);
    const unit = match[2].toLowerCase();
    const multipliers: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };
    return value * (multipliers[unit] || 3600);
};

const DEFAULT_ACCESS_TTL_SECONDS = parseAccessTokenTtlSeconds();

export const isShareExpired = (expiresAt: string | Date | null): boolean => {
    if (!expiresAt) return false;
    return new Date(expiresAt).getTime() < Date.now();
};

export const signShareLinkToken = (share: Pick<ShareRow, 'id' | 'folder_id' | 'file_id'>, expiresAt: string | Date | null): string => {
    const expiresInSeconds = expiresAt
        ? Math.max(1, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000))
        : 7 * 24 * 60 * 60;

    return jwt.sign(
        {
            typ: 'share_link',
            shareId: share.id,
            folderId: share.folder_id,
            fileId: share.file_id,
        } satisfies ShareLinkPayload,
        SHARE_LINK_SECRET,
        { expiresIn: expiresInSeconds }
    );
};

export const verifyShareLinkToken = (token: string): ShareLinkPayload | null => {
    try {
        const payload = jwt.verify(token, SHARE_LINK_SECRET) as ShareLinkPayload;
        if (payload?.typ !== 'share_link' || !payload.shareId) return null;
        return payload;
    } catch {
        return null;
    }
};

export const signShareAccessToken = (share: Pick<ShareRow, 'id' | 'folder_id' | 'file_id'>): string => {
    return jwt.sign(
        {
            typ: 'share_access',
            shareId: share.id,
            folderId: share.folder_id,
            fileId: share.file_id,
        } satisfies ShareAccessPayload,
        SHARE_ACCESS_SECRET,
        { expiresIn: DEFAULT_ACCESS_TTL_SECONDS }
    );
};

export const verifyShareAccessToken = (token: string): ShareAccessPayload | null => {
    try {
        const payload = jwt.verify(token, SHARE_ACCESS_SECRET) as ShareAccessPayload;
        if (payload?.typ !== 'share_access' || !payload.shareId) return null;
        return payload;
    } catch {
        return null;
    }
};

export const getShareUrl = (shareId: string, token: string): string => {
    return `${SHARE_PUBLIC_BASE_URL}/share/${encodeURIComponent(shareId)}?token=${encodeURIComponent(token)}`;
};

export const readBearerToken = (req: Request): string | null => {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) return null;
    return header.slice('Bearer '.length).trim() || null;
};

export const readShareAccessToken = (req: Request): string | null => {
    const bearer = readBearerToken(req);
    if (bearer) return bearer;
    const fromQuery = req.query.accessToken;
    if (typeof fromQuery === 'string' && fromQuery) return fromQuery;
    return null;
};

export const normalizeSharePath = (value: unknown): string => {
    const raw = String(value || '/').trim();
    if (!raw || raw === '/') return '';

    const normalized = raw
        .replace(/\\/g, '/')
        .replace(/\/+/g, '/')
        .replace(/\.\./g, '')
        .replace(/^\//, '')
        .replace(/\/$/, '');

    return normalized || '';
};

export const toDisplaySharePath = (path: string): string => {
    return path ? `/${path}` : '/';
};

export const buildBreadcrumbs = (path: string) => {
    if (!path) return [{ label: 'Root', path: '/' }];

    const parts = path.split('/').filter(Boolean);
    const crumbs = [{ label: 'Root', path: '/' }];
    parts.forEach((part, index) => {
        crumbs.push({
            label: part,
            path: `/${parts.slice(0, index + 1).join('/')}`,
        });
    });
    return crumbs;
};

export const getShareSort = (sortBy: unknown, order: unknown) => {
    const safeOrder = String(order || 'asc').toLowerCase() === 'desc' ? 'DESC' : 'ASC';
    const sortMap: Record<string, string> = {
        name: 'file_name',
        date: 'created_at',
        size: 'file_size',
    };
    const safeColumn = sortMap[String(sortBy || 'name').toLowerCase()] || 'file_name';
    return { column: safeColumn, direction: safeOrder };
};
