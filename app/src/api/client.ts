import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

// ─────────────────────────────────────────────────────────────────────────────
// API URL
// - Web (Expo browser preview): localhost works fine
// - Physical device (iOS/Android): must use LAN IP
//   Your WiFi IP: 192.168.1.47  — update if network changes
// ─────────────────────────────────────────────────────────────────────────────
const PRODUCTION_URL = 'https://axya-cloud-production.up.railway.app';
const LAN_IP = '192.168.1.47';
const PORT = '3000';

export const API_BASE: string = process.env.EXPO_PUBLIC_API_URL || (() => {
    if (Platform.OS === 'web') return `http://localhost:${PORT}`;
    // Use production URL as the primary fallback for phone builds
    return PRODUCTION_URL;
})();

// ── Default client (auth + regular API calls) ──────────────────────────────
const client = axios.create({
    baseURL: API_BASE,
    timeout: 20_000,
});

// ── Upload client (longer timeout for Telegram uploads) ────────────────────
export const uploadClient = axios.create({
    baseURL: API_BASE,
    timeout: 120_000,   // 2 min for large Telegram uploads
});

// ── JWT injection interceptor ──────────────────────────────────────────────
const injectToken = async (config: any) => {
    try {
        let token = await AsyncStorage.getItem('jwtToken');
        if (Platform.OS === 'web' && !token) {
            token = localStorage.getItem('jwtToken');
        }
        if (token) {
            config.headers = config.headers ?? {};
            config.headers.Authorization = `Bearer ${token}`;
        }
    } catch (e) {
        console.warn('[API] Could not read JWT from storage:', e);
    }
    return config;
};

client.interceptors.request.use(injectToken, Promise.reject);
uploadClient.interceptors.request.use(injectToken, Promise.reject);

// ── Response interceptor ───────────────────────────────────────────────────
// ⚠️  Do NOT auto-clear the token on every 401.
//     Some endpoints return 401 transiently (e.g. Telegram session refresh).
//     Auto-clearing logs the user out silently and causes "Unauthorized" on
//     the very next request that still has a valid session.
//
//     Instead: pass the error through so the UI can show a proper message,
//     and only clear the token explicitly from the logout flow.
const handleError = (error: any) => Promise.reject(error);

client.interceptors.response.use(r => r, handleError);
uploadClient.interceptors.response.use(r => r, handleError);

export default client;
