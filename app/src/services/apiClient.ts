import axios, { AxiosInstance, InternalAxiosRequestConfig, AxiosError } from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { shouldRetry, sleep } from '../utils/retry';
import { serverStatusManager } from '../context/ServerStatusContext';

const PRODUCTION_URL = 'https://axya-cloud.onrender.com';
const PORT = '3000';

export const API_BASE: string = process.env.EXPO_PUBLIC_API_URL || (() => {
    if (Platform.OS === 'web') return `http://localhost:${PORT}`;
    return PRODUCTION_URL;
})();

interface CustomAxiosRequestConfig extends InternalAxiosRequestConfig {
    reqId?: string;
    _retryCount?: number;
    _maxRetries?: number;
}

const apiClient = axios.create({
    baseURL: API_BASE,
    timeout: 15_000, // 15s for standard API
});

export const uploadClient = axios.create({
    baseURL: API_BASE,
    // ✅ Was 0 (infinite) — a stalled upload would hang forever.
    // 10 min is generous for a 100MB file on slow connections.
    // UploadManager will retry via its own MAX_RETRIES logic.
    timeout: 10 * 60 * 1000,
});

const requestTimers = new Map<string, NodeJS.Timeout>();

const injectTokenAndLog = async (config: CustomAxiosRequestConfig) => {
    try {
        let token = await AsyncStorage.getItem('jwtToken');
        if (token) {
            if (!config.headers) config.headers = {} as any;
            (config.headers as any).Authorization = `Bearer ${token}`;
        }
    } catch (e) {
        console.warn('[API] Could not read JWT storage:', e);
    }

    const reqId = Math.random().toString(36).substring(7);
    config.reqId = reqId;

    // Show server waking UI if a request takes longer than 2 seconds
    const timer = setTimeout(() => {
        serverStatusManager.setWaking(true, 'Starting server, please wait...');
    }, 2000);
    requestTimers.set(reqId, timer);

    return config;
};

const clearWakingTimer = (reqId?: string) => {
    if (reqId && requestTimers.has(reqId)) {
        clearTimeout(requestTimers.get(reqId));
        requestTimers.delete(reqId);
    }
    serverStatusManager.setWaking(false);
};

apiClient.interceptors.request.use(injectTokenAndLog as any, Promise.reject);
uploadClient.interceptors.request.use(injectTokenAndLog as any, Promise.reject);

apiClient.interceptors.response.use(
    (response: any) => {
        clearWakingTimer((response.config as CustomAxiosRequestConfig)?.reqId);
        return response;
    },
    async (error: AxiosError): Promise<any> => {
        const config = error.config as CustomAxiosRequestConfig;
        clearWakingTimer(config?.reqId);

        if (!config) return Promise.reject(error);

        config._retryCount = config._retryCount ?? 0;
        config._maxRetries = config._maxRetries ?? 3;

        if (shouldRetry(error) && config._retryCount < config._maxRetries) {
            config._retryCount += 1;
            const delay = Math.pow(2, config._retryCount) * 1000;
            console.warn(`⏳ [API Retry] ${config.url} failed. Retrying in ${delay / 1000}s...`);

            serverStatusManager.setWaking(true, `Retrying connection... (${config._retryCount}/${config._maxRetries})`);
            await sleep(delay);

            return apiClient(config);
        }

        serverStatusManager.setWaking(false);
        return Promise.reject(error);
    }
);

uploadClient.interceptors.response.use(
    (res) => {
        clearWakingTimer((res.config as CustomAxiosRequestConfig)?.reqId);
        return res;
    },
    (e) => {
        clearWakingTimer((e.config as CustomAxiosRequestConfig)?.reqId);
        return Promise.reject(e);
    }
);

export default apiClient;
