import axios, { AxiosInstance, InternalAxiosRequestConfig, AxiosError } from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { useServerStatusStore } from '../context/ServerStatusStore';
import { shouldRetry, sleep } from '../utils/retry';

// ─────────────────────────────────────────────────────────────────────────────
// API URL
// ─────────────────────────────────────────────────────────────────────────────
const PRODUCTION_URL = 'https://axya-cloud.onrender.com';
const PORT = '3000';

export const API_BASE: string = process.env.EXPO_PUBLIC_API_URL || (() => {
    if (Platform.OS === 'web') return `http://localhost:${PORT}`;
    return PRODUCTION_URL;
})();

// ── Custom Config Types ────────────────────────────────────────────────────
interface CustomAxiosRequestConfig extends InternalAxiosRequestConfig {
    reqId?: string;
    _retryCount?: number;
    _maxRetries?: number;
}

// ── Default client (auth + regular API calls, strict 10s initial timeout) ────
const client = axios.create({
    baseURL: API_BASE,
    timeout: 10_000,
});

// ── Upload client (longer timeout for large files) ─────────────────────────
export const uploadClient = axios.create({
    baseURL: API_BASE,
    timeout: 120_000,
});

// ── JWT injection & Request Logger ─────────────────────────────────────────
const injectTokenAndLog = async (config: CustomAxiosRequestConfig) => {
    try {
        let token = await AsyncStorage.getItem('jwtToken');
        if (Platform.OS === 'web' && !token) {
            token = localStorage.getItem('jwtToken');
        }
        if (token) {
            if (!config.headers) {
                config.headers = {} as any;
            }
            (config.headers as any).Authorization = `Bearer ${token}`;
        }
    } catch (e) {
        console.warn('[API] Could not read JWT from storage:', e);
    }

    // Log outgoing requests
    console.log(`📡 [API Call] ${config.method?.toUpperCase()} ${config.url}`);

    // Setup Waking State trigger
    const reqId = Math.random().toString(36).substring(7);
    config.reqId = reqId;

    // Trigger waking UI if it takes longer than 2 seconds
    const timer = setTimeout(() => {
        useServerStatusStore.getState().setIsWaking(true);
    }, 2000);
    requestTimers.set(reqId, timer);

    return config;
};

const requestTimers = new Map<string, NodeJS.Timeout>();

client.interceptors.request.use(injectTokenAndLog, Promise.reject);
uploadClient.interceptors.request.use(injectTokenAndLog, Promise.reject);

// ── Clear loading state ────────────────────────────────────────────────────
const clearWakingTimer = (reqId?: string) => {
    if (reqId && requestTimers.has(reqId)) {
        clearTimeout(requestTimers.get(reqId));
        requestTimers.delete(reqId);
    }
    useServerStatusStore.getState().setIsWaking(false);
};

// ── Response Interceptors (Global retry logic) ─────────────────────────────
const handleSuccess = (response: any) => {
    clearWakingTimer(response.config?.reqId);
    return response;
};

const handleErrorAndRetry = async (error: AxiosError): Promise<any> => {
    const config = error.config as CustomAxiosRequestConfig;
    clearWakingTimer(config?.reqId);

    if (!config) return Promise.reject(error);

    // Initialize retry state dynamically
    config._retryCount = config._retryCount ?? 0;
    config._maxRetries = config._maxRetries ?? 3;

    if (shouldRetry(error) && config._retryCount < config._maxRetries) {
        config._retryCount += 1;

        // Exponential backoff: 2s -> 4s -> 8s
        const delay = Math.pow(2, config._retryCount) * 1000;
        console.warn(`⏳ [API Retry] Request failed. Retrying in ${delay / 1000}s... (${config._retryCount}/${config._maxRetries})`);

        // Notify user again via sticky banner that we are retrying
        useServerStatusStore.getState().setIsWaking(true);

        await sleep(delay);

        // Ensure new request has valid headers
        return client(config);
    }

    // Final failure - stop waking UI
    useServerStatusStore.getState().setIsWaking(false);
    return Promise.reject(error);
};

client.interceptors.response.use(handleSuccess, handleErrorAndRetry);
// Uploads generally shouldn't auto-retry recursively to prevent double buffering
uploadClient.interceptors.response.use(handleSuccess, (e) => {
    clearWakingTimer(e.config?.reqId);
    return Promise.reject(e);
});

export default client;
