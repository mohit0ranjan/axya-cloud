import { logger } from '../utils/logger';
import { Platform } from 'react-native';

const DEFAULT_BACKEND_URL = 'https://axya-server.onrender.com';
const DEV_BACKEND_URL = Platform.select({
    android: 'http://10.0.2.2:3000',
    ios: 'http://localhost:3000',
    web: 'http://localhost:3000',
    default: 'http://localhost:3000',
}) || 'http://localhost:3000';
const LOCAL_ADDRESS_RE = /^https?:\/\/(localhost|127\.0\.0\.1|10\.0\.2\.2|10\.0\.3\.2|192\.168\.\d{1,3}\.\d{1,3})(:\d+)?$/i;

const sanitizeUrl = (url: string | undefined, fallback: string, allowLocalhost: boolean): string => {
    const trimmed = String(url || '').trim().replace(/\/+$/, '');
    const normalized = trimmed ? trimmed.replace(/\/api$/i, '') : fallback;

    if (LOCAL_ADDRESS_RE.test(normalized) && !allowLocalhost) {
        logger.warn('frontend.config', 'api_url.localhost_ignored', {
            configuredUrl: normalized,
            fallbackUrl: fallback,
            dev: typeof __DEV__ !== 'undefined' ? __DEV__ : undefined,
        });
        return fallback;
    }

    return normalized;
};

const allowLocalhost = typeof __DEV__ !== 'undefined' ? __DEV__ : false;

export const API_URL = sanitizeUrl(
    process.env.EXPO_PUBLIC_API_URL,
    allowLocalhost ? DEV_BACKEND_URL : DEFAULT_BACKEND_URL,
    allowLocalhost
);

if (!allowLocalhost && LOCAL_ADDRESS_RE.test(API_URL)) {
    throw new Error('API_URL resolved to localhost/127.0.0.1. Mobile builds must use the deployed backend URL.');
}
