import { logger } from '../utils/logger';

const AZURE_BACKEND_URL = 'https://axyzcloud-a8fgczdhhjhxexhg.centralindia-01.azurewebsites.net';
const LOCAL_ADDRESS_RE = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i;

const sanitizeUrl = (url: string | undefined, fallback: string): string => {
    const trimmed = String(url || '').trim().replace(/\/+$/, '');
    const normalized = trimmed ? trimmed.replace(/\/api$/i, '') : fallback;

    if (LOCAL_ADDRESS_RE.test(normalized)) {
        logger.warn('frontend.config', 'api_url.localhost_ignored', {
            configuredUrl: normalized,
            fallbackUrl: fallback,
            dev: typeof __DEV__ !== 'undefined' ? __DEV__ : undefined,
        });
        return fallback;
    }

    return normalized;
};

export const API_URL = sanitizeUrl(
    process.env.EXPO_PUBLIC_API_URL,
    AZURE_BACKEND_URL
);

if (LOCAL_ADDRESS_RE.test(API_URL)) {
    throw new Error('API_URL resolved to localhost/127.0.0.1. Mobile builds must use the Azure backend URL.');
}
