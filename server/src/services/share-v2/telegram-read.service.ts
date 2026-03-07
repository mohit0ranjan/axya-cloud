import crypto from 'crypto';
import NodeCache from 'node-cache';
import pool from '../../config/db';
import { getDynamicClient } from '../telegram.service';

type TelegramReadClassification = 'telegram_timeout' | 'telegram_message_missing' | 'telegram_session_invalid';

export type TelegramReadFailure = {
    code: TelegramReadClassification;
    status: number;
    retryable: boolean;
    message: string;
};

const messageClientCache = new NodeCache({ stdTTL: 30 * 60, checkperiod: 120, useClones: false });
const sessionCircuitBreak = new NodeCache({ stdTTL: 60, checkperiod: 30, useClones: false });

const hashSession = (session: string) => crypto.createHash('sha256').update(session).digest('hex').slice(0, 16);
const messageCacheKey = (chatId: string, messageId: number) => `${chatId}:${messageId}`;

const classifyTelegramError = (err: unknown): TelegramReadClassification => {
    const raw = String((err as any)?.message || '').toUpperCase();

    if (
        raw.includes('AUTH_KEY')
        || raw.includes('SESSION_REVOKED')
        || raw.includes('SESSION_EXPIRED')
        || raw.includes('USER_DEACTIVATED')
    ) {
        return 'telegram_session_invalid';
    }

    if (
        raw.includes('TIMEOUT')
        || raw.includes('TIMED OUT')
        || raw.includes('ETIMEDOUT')
        || raw.includes('NETWORK_MIGRATE')
        || raw.includes('FLOOD_WAIT')
    ) {
        return 'telegram_timeout';
    }

    if (
        raw.includes('MESSAGE_ID_INVALID')
        || raw.includes('FILE_REFERENCE')
        || raw.includes('MEDIA_EMPTY')
        || raw.includes('PEER_ID_INVALID')
        || raw.includes('CHAT_ID_INVALID')
        || raw.includes('CHANNEL_INVALID')
    ) {
        return 'telegram_message_missing';
    }

    return 'telegram_timeout';
};

const toFailure = (code: TelegramReadClassification): TelegramReadFailure => {
    if (code === 'telegram_message_missing') {
        return {
            code,
            status: 404,
            retryable: false,
            message: 'Shared file is no longer available in Telegram.',
        };
    }
    if (code === 'telegram_session_invalid') {
        return {
            code,
            status: 503,
            retryable: false,
            message: 'Telegram session is invalid for this share.',
        };
    }
    return {
        code: 'telegram_timeout',
        status: 502,
        retryable: true,
        message: 'Telegram timed out while reading shared content.',
    };
};

const withRetryOnce = async <T>(fn: () => Promise<T>): Promise<T> => {
    try {
        return await fn();
    } catch (err) {
        const code = classifyTelegramError(err);
        if (code !== 'telegram_timeout') throw err;
        return await fn();
    }
};

const getSessionCandidates = async (ownerUserId: string): Promise<string[]> => {
    const ownerRes = await pool.query('SELECT session_string FROM users WHERE id = $1', [ownerUserId]);
    const ownerSession = String(ownerRes.rows[0]?.session_string || '').trim();

    const candidates = [
        ownerSession,
        String(process.env.TELEGRAM_STORAGE_SESSION || '').trim(),
        String(process.env.TELEGRAM_SESSION || '').trim(),
    ].filter(Boolean);

    return Array.from(new Set(candidates));
};

export const resolveTelegramMessageForShareItem = async (
    ownerUserId: string,
    chatId: string,
    messageId: number,
): Promise<{ client: any; message: any } | { failure: TelegramReadFailure }> => {
    const sessions = await getSessionCandidates(ownerUserId);
    if (!sessions.length) {
        return { failure: toFailure('telegram_session_invalid') };
    }

    const key = messageCacheKey(chatId, messageId);
    const preferred = String(messageClientCache.get(key) || '');
    if (preferred) {
        const idx = sessions.findIndex((s) => hashSession(s) === preferred);
        if (idx > 0) {
            const [v] = sessions.splice(idx, 1);
            sessions.unshift(v);
        }
    }

    const seen = new Set<TelegramReadClassification>();

    for (const sessionString of sessions) {
        const sid = hashSession(sessionString);
        if (sessionCircuitBreak.get(sid)) continue;

        try {
            const client = await getDynamicClient(sessionString);
            const messages = await withRetryOnce(() => client.getMessages(chatId, { ids: messageId }));
            if (messages && messages.length > 0 && messages[0]) {
                messageClientCache.set(key, sid);
                return { client, message: messages[0] };
            }
            seen.add('telegram_message_missing');
        } catch (err) {
            const code = classifyTelegramError(err);
            seen.add(code);

            if (code === 'telegram_session_invalid') {
                sessionCircuitBreak.set(sid, true);
                continue;
            }

            if (code === 'telegram_message_missing') {
                // Try fallback session before finalizing.
                continue;
            }
        }
    }

    if (seen.has('telegram_message_missing')) return { failure: toFailure('telegram_message_missing') };
    if (seen.has('telegram_session_invalid')) return { failure: toFailure('telegram_session_invalid') };
    return { failure: toFailure('telegram_timeout') };
};
