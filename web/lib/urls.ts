const sanitizeUrl = (url: string | undefined, fallback: string): string => {
    const trimmed = String(url || '').trim().replace(/\/+$/, '');
    return trimmed || fallback;
};

// We are assuming a local backend running on port 3000 for local dev if missing.
const AZURE_DOMAIN = 'https://axyzcloud-a8fgczdhhjhxexhg.centralindia-01.azurewebsites.net';
// Default to the actual backend on Azure so NextJS builds don't fail when missing env vars
const DEFAULT_API_URL = AZURE_DOMAIN;

export const API_URL = sanitizeUrl(
    process.env.NEXT_PUBLIC_API_URL || process.env.NEXT_PUBLIC_API_BASE,
    DEFAULT_API_URL
);

export const getServerUrl = () => {
    return process.env.NEXT_PUBLIC_SITE_URL ||
        (typeof window !== 'undefined' ? window.location.origin : AZURE_DOMAIN);
};

export const FRONTEND_BASE_URL = sanitizeUrl(
    process.env.NEXT_PUBLIC_BASE_URL,
    typeof window !== 'undefined' ? window.location.origin : AZURE_DOMAIN
);
