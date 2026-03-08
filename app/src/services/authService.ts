import { AxiosError } from 'axios';
import apiClient, { serializeAxiosError } from './apiClient';
import { API_URL } from '../config/urls';
import { logger } from '../utils/logger';

export interface HealthStatus {
    status: string;
    service: string;
    schemaState?: string;
    schemaReady?: boolean;
    telegramWarmupStatus?: string;
}

export interface SendOtpResult {
    phoneCodeHash: string;
    tempSession: string;
}

export interface VerifyOtpInput {
    phoneNumber: string;
    phoneCodeHash: string;
    phoneCode: string;
    tempSession: string;
}

export interface AuthResult {
    token: string;
    user: any;
    message?: string;
}

const maskPhone = (phoneNumber: string) => {
    const normalized = String(phoneNumber || '').trim();
    if (normalized.length <= 4) return normalized;
    return `${normalized.slice(0, 3)}***${normalized.slice(-2)}`;
};

const getUserFacingMessage = (error: unknown, fallback: string) => {
    const axiosError = error as AxiosError<any>;
    const data = axiosError?.response?.data;

    if (typeof data?.error === 'string' && data.error.trim()) return data.error.trim();
    if (typeof data?.message === 'string' && data.message.trim()) return data.message.trim();
    if (axiosError?.code === 'ECONNABORTED') return 'Server timeout. Please try again.';
    if (!axiosError?.response) return 'Unable to reach the server. Please check your internet connection and try again.';
    if (error instanceof Error && error.message.trim()) return error.message.trim();
    return fallback;
};

const logOtpError = (event: string, error: AxiosError, meta: Record<string, unknown>) => {
    const serializedError = serializeAxiosError(error);
    logger.error('frontend.auth', event, {
        ...meta,
        baseUrl: API_URL,
        error: serializedError,
        errorMessage: error.message,
        errorResponse: serializedError.response,
        errorRequest: serializedError.request,
    });
};

export const checkApiHealth = async (): Promise<HealthStatus> => {
    const { data } = await apiClient.get<HealthStatus>('/health', {
        timeout: 10_000,
        _maxRetries: 0,
    } as any);
    return data;
};

export const sendOtp = async (phoneNumber: string): Promise<SendOtpResult> => {
    const payload = { phoneNumber: String(phoneNumber || '').trim() };
    logger.info('frontend.auth', 'otp.send.start', {
        route: '/auth/send-code',
        baseUrl: API_URL,
        timeout: 15_000,
        payload: { phoneNumber: maskPhone(payload.phoneNumber) },
    });

    try {
        const health = await checkApiHealth();
        logger.info('frontend.auth', 'otp.health.ok', {
            route: '/health',
            baseUrl: API_URL,
            health,
        });
    } catch (error) {
        if ((error as AxiosError)?.isAxiosError) {
            logOtpError('otp.health.failed', error as AxiosError, {
                route: '/health',
                payload: { phoneNumber: maskPhone(payload.phoneNumber) },
            });
        }
        throw new Error(getUserFacingMessage(error, 'Server is unavailable. Please try again.'));
    }

    try {
        const { data } = await apiClient.post('/auth/send-code', payload, {
            timeout: 15_000,
            _allowRetry: true,
            _maxRetries: 2,
        } as any);

        if (!data?.success || !data?.phoneCodeHash || !data?.tempSession) {
            throw new Error(data?.error || 'Failed to send OTP.');
        }

        logger.info('frontend.auth', 'otp.send.success', {
            route: '/auth/send-code',
            baseUrl: API_URL,
            payload: { phoneNumber: maskPhone(payload.phoneNumber) },
        });

        return {
            phoneCodeHash: data.phoneCodeHash,
            tempSession: data.tempSession,
        };
    } catch (error) {
        if ((error as AxiosError)?.isAxiosError) {
            logOtpError('otp.send.failed', error as AxiosError, {
                route: '/auth/send-code',
                payload: { phoneNumber: maskPhone(payload.phoneNumber) },
            });
        }
        throw new Error(getUserFacingMessage(error, 'Failed to send OTP. Please try again.'));
    }
};

export const verifyOtp = async (input: VerifyOtpInput): Promise<AuthResult> => {
    const payload: VerifyOtpInput = {
        phoneNumber: String(input.phoneNumber || '').trim(),
        phoneCodeHash: String(input.phoneCodeHash || '').trim(),
        phoneCode: String(input.phoneCode || '').trim(),
        tempSession: String(input.tempSession || '').trim(),
    };

    logger.info('frontend.auth', 'otp.verify.start', {
        route: '/auth/verify-code',
        baseUrl: API_URL,
        timeout: 15_000,
        payload: {
            phoneNumber: maskPhone(payload.phoneNumber),
            hasPhoneCodeHash: Boolean(payload.phoneCodeHash),
            phoneCodeLength: payload.phoneCode.length,
            hasTempSession: Boolean(payload.tempSession),
        },
    });

    try {
        const { data } = await apiClient.post('/auth/verify-code', payload, {
            timeout: 15_000,
            _allowRetry: true,
            _maxRetries: 1,
        } as any);

        if (!data?.success || !data?.token) {
            throw new Error(data?.error || 'OTP verification failed.');
        }

        logger.info('frontend.auth', 'otp.verify.success', {
            route: '/auth/verify-code',
            baseUrl: API_URL,
            payload: {
                phoneNumber: maskPhone(payload.phoneNumber),
                userId: data.user?.id,
            },
        });

        return {
            token: data.token,
            user: data.user,
            message: data.message,
        };
    } catch (error) {
        if ((error as AxiosError)?.isAxiosError) {
            logOtpError('otp.verify.failed', error as AxiosError, {
                route: '/auth/verify-code',
                payload: {
                    phoneNumber: maskPhone(payload.phoneNumber),
                    hasPhoneCodeHash: Boolean(payload.phoneCodeHash),
                    phoneCodeLength: payload.phoneCode.length,
                    hasTempSession: Boolean(payload.tempSession),
                },
            });
        }
        throw new Error(getUserFacingMessage(error, 'Verification failed. Please try again.'));
    }
};
