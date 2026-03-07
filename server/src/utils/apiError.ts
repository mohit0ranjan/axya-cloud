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

    if (typeof options.retryAfterSeconds === 'number' && options.retryAfterSeconds > 0) {
        payload.retry_after_seconds = Math.floor(options.retryAfterSeconds);
        res.setHeader('Retry-After', String(Math.floor(options.retryAfterSeconds)));
    }

    if (options.details !== undefined) {
        payload.details = options.details;
    }

    return res.status(status).json(payload);
};
