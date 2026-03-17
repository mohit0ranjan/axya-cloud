import { sanitizeRemoteUri } from './fileSafety';

const DEFAULT_PUBLIC_WEB_URL = 'https://axya-web.onrender.com';

const sanitizeShareBase = (value: string): string => {
    const trimmed = String(value || '').trim().replace(/\/+$/, '');
    if (!trimmed) return '';
    return trimmed.replace(/\/api$/i, '');
};

export const PUBLIC_SHARE_BASE_URL = sanitizeShareBase(
    process.env.EXPO_PUBLIC_SHARE_BASE_URL
    || process.env.EXPO_PUBLIC_SITE_URL
    || process.env.EXPO_PUBLIC_BASE_URL
    || DEFAULT_PUBLIC_WEB_URL
);

export const normalizeExternalShareUrl = (rawUrl: string): string => {
    const input = sanitizeRemoteUri(rawUrl);
    if (!input) return '';

    try {
        const parsed = new URL(input);
        return `${PUBLIC_SHARE_BASE_URL}${parsed.pathname}${parsed.search}`.replace(/([^:]\/)\/+/g, '$1');
    } catch {
        return input;
    }
};

export const buildExternalShareUrl = (slug: string, secret?: string | null): string => {
    const cleanSlug = encodeURIComponent(String(slug || '').trim());
    const cleanSecret = String(secret || '').trim();
    if (!cleanSlug) return '';

    const query = cleanSecret ? `?k=${encodeURIComponent(cleanSecret)}` : '';
    return `${PUBLIC_SHARE_BASE_URL}/s/${cleanSlug}${query}`;
};

export const resolveShareUrl = (payload: any): string => {
    const directUrl = normalizeExternalShareUrl(String(payload?.share_url || payload?.shareUrl || ''));
    if (directUrl) return directUrl;

    const slug = String(payload?.slug || payload?.share?.slug || '').trim();
    const secret = String(payload?.secret || payload?.share?.secret || '').trim();
    return buildExternalShareUrl(slug, secret);
};
