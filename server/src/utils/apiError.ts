import { Response } from 'express';

export type ApiErrorCode =
    | 'schema_not_ready'
    | 'invalid_request'
    | 'not_found'
    | 'unauthorized'
    | 'forbidden'
    | 'conflict'
    | 'rate_limited'
    | 'telegram_session_expired'
    | 'telegram_message_not_found'
    | 'telegram_chat_invalid'
    | 'telegram_transient'
    | 'internal_error';

export interface ApiErrorPayload {
    success: false;
    code: ApiErrorCode | string;
    message: string;
    error: string;
    retryable: boolean;
    retry_after_seconds?: number;
    details?: unknown;
}

export interface ApiSuccessPayload<T = unknown> {
    success: true;
    data: T;
    meta?: Record<string, unknown>;
}

type ApiErrorOptions = {
    retryable?: boolean;
    retryAfterSeconds?: number;
    details?: unknown;
};

export const sendApiError = (
    res: Response,
    status: number,
    code: ApiErrorCode | string,
    message: string,
    options: ApiErrorOptions = {}
) => {
    const retryable = options.retryable ?? status >= 500;
    const payload: ApiErrorPayload = {
        success: false,
        code,
        message,
        error: message,
        retryable,
    };

    const requestId = String(res.getHeader('x-request-id') || '').trim();

    if (typeof options.retryAfterSeconds === 'number' && options.retryAfterSeconds > 0) {
        payload.retry_after_seconds = Math.floor(options.retryAfterSeconds);
        res.setHeader('Retry-After', String(Math.floor(options.retryAfterSeconds)));
    }

    if (options.details !== undefined) {
        payload.details = options.details;
    }

    if (requestId) {
        if (payload.details && typeof payload.details === 'object' && !Array.isArray(payload.details)) {
            payload.details = { ...(payload.details as Record<string, unknown>), requestId };
        } else if (payload.details === undefined) {
            payload.details = { requestId };
        }
    }

    return res.status(status).json(payload);
};

export const sendApiSuccess = <T>(
    res: Response,
    data: T,
    meta?: Record<string, unknown>
) => {
    const payload: ApiSuccessPayload<T> = {
        success: true,
        data,
    };
    if (meta && Object.keys(meta).length > 0) {
        payload.meta = meta;
    }
    return res.json(payload);
};
