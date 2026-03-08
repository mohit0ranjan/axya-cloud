import axios, { AxiosInstance, InternalAxiosRequestConfig, AxiosError } from 'axios';
import { shouldRetry, sleep } from '../utils/retry';
import { serverStatusManager } from '../context/ServerStatusContext';
import { logger } from '../utils/logger';
import { getSecureValue, SECURE_KEYS } from '../utils/secureStorage';

import { API_URL as API_BASE } from '../config/urls';

export { API_BASE };

interface CustomAxiosRequestConfig extends InternalAxiosRequestConfig {
    reqId?: string;
    _retryCount?: number;
    _maxRetries?: number;
    _startedAt?: number;
    _allowRetry?: boolean;
}

const serializeAxiosRequest = (request: unknown) => {
    if (!request || typeof request !== 'object') return undefined;

    const candidate = request as Record<string, unknown>;
    return {
        readyState: candidate.readyState,
        status: candidate.status,
        timeout: candidate.timeout,
        responseURL: candidate.responseURL,
        hasResponse: Boolean(candidate.response),
        responseType: candidate.responseType,
        withCredentials: candidate.withCredentials,
    };
};

export const serializeAxiosError = (error: AxiosError) => ({
    code: error.code,
    message: error.message,
    status: error.response?.status,
    response: error.response
        ? {
            status: error.response.status,
            headers: error.response.headers,
            data: error.response.data,
        }
        : undefined,
    request: serializeAxiosRequest(error.request),
});

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
        const token = await getSecureValue(SECURE_KEYS.JWT_TOKEN);
        if (token) {
            if (!config.headers) config.headers = {} as any;
            (config.headers as any).Authorization = `Bearer ${token}`;
        }
    } catch (e) {
        console.warn('[API] Could not read JWT storage:', e);
    }

    const reqId = Math.random().toString(36).substring(7);
    config.reqId = reqId;
    config._startedAt = Date.now();
    logger.info('frontend.api', 'request.start', {
        reqId,
        method: config.method,
        baseURL: config.baseURL,
        url: config.url,
        timeout: config.timeout,
    });

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

const shouldRetryRequestMethod = (config: CustomAxiosRequestConfig): boolean => {
    const method = String(config.method || 'get').toUpperCase();
    if (config._allowRetry === true) return true;
    return method === 'GET' || method === 'HEAD' || method === 'OPTIONS';
};

apiClient.interceptors.request.use(injectTokenAndLog as any, Promise.reject);
uploadClient.interceptors.request.use(injectTokenAndLog as any, Promise.reject);

apiClient.interceptors.response.use(
    (response: any) => {
        const cfg = response.config as CustomAxiosRequestConfig;
        clearWakingTimer(cfg?.reqId);
        logger.info('frontend.api', 'request.success', {
            reqId: cfg?.reqId,
            method: cfg?.method,
            url: cfg?.url,
            status: response.status,
            durationMs: cfg?._startedAt ? Date.now() - cfg._startedAt : undefined,
        });
        return response;
    },
    async (error: AxiosError): Promise<any> => {
        const config = error.config as CustomAxiosRequestConfig;
        clearWakingTimer(config?.reqId);
        logger.error('frontend.api', 'request.error', {
            reqId: config?.reqId,
            method: config?.method,
            baseURL: config?.baseURL,
            url: config?.url,
            code: error.code,
            status: error.response?.status,
            message: error.message,
            response: error.response
                ? {
                    headers: error.response.headers,
                    data: error.response.data,
                }
                : undefined,
            request: serializeAxiosRequest(error.request),
            durationMs: config?._startedAt ? Date.now() - config._startedAt : undefined,
        });

        if (!config) return Promise.reject(error);

        config._retryCount = config._retryCount ?? 0;
        config._maxRetries = config._maxRetries ?? 2;
        const serverRetryable = typeof (error.response?.data as any)?.retryable === 'boolean'
            ? Boolean((error.response?.data as any)?.retryable)
            : undefined;
        const retryAfterSec = Number((error.response?.data as any)?.retry_after_seconds || 0);

        if (
            shouldRetryRequestMethod(config)
            && (serverRetryable !== false)
            && shouldRetry(error)
            && config._retryCount < config._maxRetries
        ) {
            config._retryCount += 1;
            const baseDelay = Math.pow(2, config._retryCount) * 1000;
            const jitterMs = Math.floor(Math.random() * 350);
            const retryAfterMs = retryAfterSec > 0 ? retryAfterSec * 1000 : 0;
            const delay = Math.max(baseDelay + jitterMs, retryAfterMs);
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
        const cfg = res.config as CustomAxiosRequestConfig;
        clearWakingTimer(cfg?.reqId);
        logger.info('frontend.upload', 'request.success', {
            reqId: cfg?.reqId,
            method: cfg?.method,
            url: cfg?.url,
            status: res.status,
            durationMs: cfg?._startedAt ? Date.now() - cfg._startedAt : undefined,
        });
        return res;
    },
    (e) => {
        const cfg = e.config as CustomAxiosRequestConfig;
        clearWakingTimer(cfg?.reqId);
        logger.error('frontend.upload', 'request.error', {
            reqId: cfg?.reqId,
            method: cfg?.method,
            url: cfg?.url,
            code: e.code,
            status: e.response?.status,
            message: e.message,
            durationMs: cfg?._startedAt ? Date.now() - cfg._startedAt : undefined,
        });
        return Promise.reject(e);
    }
);

export default apiClient;
