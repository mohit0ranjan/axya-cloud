import { ApiErrorCode } from './apiError';

export type TelegramErrorMapping = {
    status: number;
    code: ApiErrorCode | string;
    message: string;
    retryable: boolean;
};

const includesAny = (value: string, parts: string[]) => parts.some((p) => value.includes(p));

export const mapTelegramError = (err: unknown, fallbackMessage: string): TelegramErrorMapping => {
    const raw = String((err as any)?.message || '').toUpperCase();

    if (includesAny(raw, ['AUTH_KEY', 'SESSION_REVOKED', 'SESSION_EXPIRED', 'USER_DEACTIVATED'])) {
        return {
            status: 503,
            code: 'telegram_session_expired',
            message: 'Telegram session expired. Please reconnect Telegram.',
            retryable: false,
        };
    }

    if (includesAny(raw, ['MESSAGE_ID_INVALID', 'FILE_REFERENCE', 'MEDIA_EMPTY'])) {
        return {
            status: 404,
            code: 'telegram_message_not_found',
            message: 'File no longer exists in Telegram.',
            retryable: false,
        };
    }

    if (includesAny(raw, ['CHANNEL_INVALID', 'CHAT_ID_INVALID', 'PEER_ID_INVALID'])) {
        return {
            status: 409,
            code: 'telegram_chat_invalid',
            message: 'Telegram chat mapping is invalid for this file.',
            retryable: false,
        };
    }

    if (includesAny(raw, ['FLOOD_WAIT', 'TIMEOUT', 'NETWORK_MIGRATE', 'PHONE_MIGRATE'])) {
        return {
            status: 502,
            code: 'telegram_transient',
            message: 'Telegram is temporarily unavailable. Please retry shortly.',
            retryable: true,
        };
    }

    return {
        status: 502,
        code: 'telegram_transient',
        message: fallbackMessage,
        retryable: true,
    };
};
