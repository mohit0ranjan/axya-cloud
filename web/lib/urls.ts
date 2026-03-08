const sanitizeUrl = (url: string | undefined, fallback: string): string => {
    const trimmed = String(url || '').trim().replace(/\/+$/, '');
    return trimmed || fallback;
};

// We are assuming a local backend running on port 3000 for local dev if missing.
const DEFAULT_SITE_URL = 'https://axya-web.onrender.com';
const DEFAULT_API_URL = 'https://axya-server.onrender.com';

export const API_URL = sanitizeUrl(
    process.env.NEXT_PUBLIC_API_URL || process.env.NEXT_PUBLIC_API_BASE,
    DEFAULT_API_URL
);

export const getServerUrl = () => {
    return process.env.NEXT_PUBLIC_SITE_URL ||
        (typeof window !== 'undefined' ? window.location.origin : DEFAULT_SITE_URL);
};

export const FRONTEND_BASE_URL = sanitizeUrl(
    process.env.NEXT_PUBLIC_BASE_URL,
    typeof window !== 'undefined' ? window.location.origin : DEFAULT_SITE_URL
);
