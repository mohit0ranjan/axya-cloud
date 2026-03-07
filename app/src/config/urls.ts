const sanitizeUrl = (url: string | undefined, fallback: string): string => {
    const trimmed = String(url || '').trim().replace(/\/+$/, '');
    // Keep a single canonical base and let call sites decide route prefixes.
    return trimmed ? trimmed.replace(/\/api$/i, '') : fallback;
};

// We assume local backend on 3000
const AZURE_DOMAIN = 'https://axyzcloud-a8fgczdhhjhxexhg.centralindia-01.azurewebsites.net';
// Always default to Azure Domain to prevent network errors. Local dev can supply EXPO_PUBLIC_API_URL
const DEFAULT_API_URL = AZURE_DOMAIN;

export const API_URL = sanitizeUrl(
    process.env.EXPO_PUBLIC_API_URL,
    DEFAULT_API_URL
);
