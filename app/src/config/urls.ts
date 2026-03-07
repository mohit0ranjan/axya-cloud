const sanitizeUrl = (url: string | undefined, fallback: string): string => {
    const trimmed = String(url || '').trim().replace(/\/+$/, '');
    // Keep a single canonical base and let call sites decide route prefixes.
    return trimmed ? trimmed.replace(/\/api$/i, '') : fallback;
};

// We assume local backend on 3000
const AZURE_DOMAIN = 'https://axyzcloud-a8fgczdhhjhxexhg.centralindia-01.azurewebsites.net';
// Expo environments can be tricky depending on how it's built, we check either standard NODE_ENV or custom EXPO flag.
const isProd = process.env.NODE_ENV === 'production' || process.env.EXPO_PUBLIC_ENV === 'production';
const DEFAULT_API_URL = isProd ? AZURE_DOMAIN : 'http://localhost:3000';

export const API_URL = sanitizeUrl(
    process.env.EXPO_PUBLIC_API_URL,
    DEFAULT_API_URL
);
