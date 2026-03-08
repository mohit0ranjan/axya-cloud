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
    const input = String(rawUrl || '').trim();
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
