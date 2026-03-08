import dotenv from 'dotenv';
dotenv.config();

const sanitizeUrl = (url: string | undefined, fallback: string): string => {
    const trimmed = String(url || '').trim().replace(/\/+$/, '');
    return trimmed || fallback;
};

// Default fallbacks (only used if environment variables are completely missing)
const RENDER_WEB_DOMAIN = 'https://axya-web.onrender.com';
// Default to the domain we actually host on to prevent failed redirects
const DEFAULT_FRONTEND_URL = RENDER_WEB_DOMAIN;
const DEFAULT_SERVER_URL = 'https://axya-server.onrender.com';

export const FRONTEND_BASE_URL = sanitizeUrl(
    process.env.FRONTEND_BASE_URL || process.env.SHARE_PUBLIC_BASE_URL || process.env.PUBLIC_BASE_URL,
    DEFAULT_FRONTEND_URL
);

export const SERVER_BASE_URL = sanitizeUrl(
    process.env.SERVER_BASE_URL,
    DEFAULT_SERVER_URL
);
