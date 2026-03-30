import { CustomFile } from 'telegram/client/uploads';
import { extractTelegramNativeMeta } from '../../utils/formatters';
import { getDynamicClient } from '../telegram.service';
import { StorageAdapter, StorageUploadRequest, StorageUploadResult } from './storage.adapter';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const normalizeTelegramChatTarget = (value: unknown): string => {
    const raw = String(value || '').trim();
    if (!raw) return 'me';
    if (raw === 'me') return 'me';
    if (raw.startsWith('@')) return raw.slice(1);

    const linkMatch = raw.match(/^(?:https?:\/\/)?(?:t|telegram)\.me\/(.+)$/i);
    if (!linkMatch) return raw;

    const pathPart = linkMatch[1].split('?')[0].split('#')[0];
    const parts = pathPart.split('/').filter(Boolean);
    if (parts.length === 0) return 'me';

    if (parts[0] === 'c' && parts[1]) {
        return `-100${parts[1]}`;
    }

    return parts[0].replace(/^@/, '');
};

const getUploadSessionCandidates = (ownerSessionString: string, requestedChatId: unknown) => {
    const requested = normalizeTelegramChatTarget(requestedChatId);
    const storageChat = String(process.env.TELEGRAM_STORAGE_CHAT_ID || '').trim();

    const sessionCandidates = [
        String(process.env.TELEGRAM_STORAGE_SESSION || '').trim(),
        String(process.env.TELEGRAM_SESSION || '').trim(),
        String(ownerSessionString || '').trim(),
    ].filter(Boolean);

    const uniqueSessions = Array.from(new Set(sessionCandidates));
    return uniqueSessions.map((session) => {
        const isStorageSession =
            session === String(process.env.TELEGRAM_STORAGE_SESSION || '').trim()
            || session === String(process.env.TELEGRAM_SESSION || '').trim();

        let targetChatId = requested || 'me';
        if (targetChatId === 'me' && isStorageSession && storageChat) {
            targetChatId = storageChat;
        }

        return {
            session,
            chatId: targetChatId,
        };
    });
};

export const resolveTelegramUploadTransport = async (ownerSessionString: string, requestedChatId: unknown) => {
    const candidates = getUploadSessionCandidates(ownerSessionString, requestedChatId);
    let lastErr: any = null;

    for (const candidate of candidates) {
        try {
            await getDynamicClient(candidate.session);
            return candidate;
        } catch (err: any) {
            lastErr = err;
        }
    }

    throw lastErr || new Error('No Telegram session available for upload.');
};

const uploadToTelegramWithRetry = async (
    client: any,
    chatId: string,
    params: any,
    maxRetries = 3
): Promise<any> => {
    for (let attempt = 0; attempt < maxRetries; attempt += 1) {
        try {
            return await client.sendFile(chatId, params);
        } catch (error: any) {
            const raw = String(error?.message || '');

            if (/AUTH_KEY|SESSION_REVOKED|SESSION_EXPIRED|USER_DEACTIVATED|PHONE_MIGRATE/i.test(raw)) {
                throw new Error('Telegram session expired or revoked. Please log in again.');
            }

            if (raw.includes('FLOOD_WAIT') || raw.includes('FLOOD')) {
                const waitSec = parseInt(raw.match(/\d+/)?.[0] || '15', 10);
                await sleep((waitSec + 1) * 1000);
                continue;
            }

            if (attempt < maxRetries - 1) {
                const backoffMs = Math.min(8_000, Math.pow(2, attempt + 1) * 1000);
                await sleep(backoffMs);
                continue;
            }

            throw error;
        }
    }

    throw new Error('Telegram upload failed after retries.');
};

export class TelegramStorageAdapter implements StorageAdapter {
    public readonly providerName = 'telegram' as const;

    public async uploadFile(request: StorageUploadRequest): Promise<StorageUploadResult> {
        const target = await resolveTelegramUploadTransport(request.ownerSessionString, request.requestedChatId);
        const client = await getDynamicClient(target.session);

        const customFile = new CustomFile(
            request.fileName,
            Math.max(0, Number(request.fileSize || 0)),
            request.filePath
        );

        const uploadedMessage = await uploadToTelegramWithRetry(
            client,
            target.chatId,
            {
                file: customFile,
                caption: request.caption || `[Axya] ${request.fileName}`,
                workers: 4,
                progressCallback: (progress: number) => {
                    if (!request.onProgress) return;
                    request.onProgress(Math.max(0, Math.min(1, Number(progress || 0))));
                },
            },
            3
        );

        if (!uploadedMessage) {
            throw new Error('Telegram upload returned no message');
        }

        const providerFileId = uploadedMessage.document
            ? String(uploadedMessage.document.id)
            : uploadedMessage.photo
                ? String(uploadedMessage.photo.id)
                : '';

        const nativeMeta = extractTelegramNativeMeta(uploadedMessage);

        return {
            provider: 'telegram',
            providerFileId,
            providerMessageId: String(uploadedMessage.id || ''),
            storageChatId: target.chatId,
            providerContext: {
                session: target.session,
            },
            nativeMeta,
        };
    }
}

let singletonAdapter: StorageAdapter | null = null;

export const getStorageAdapter = (): StorageAdapter => {
    if (singletonAdapter) return singletonAdapter;

    const provider = String(process.env.STORAGE_PROVIDER || 'telegram').trim().toLowerCase();
    if (provider !== 'telegram') {
        throw new Error(`Unsupported STORAGE_PROVIDER '${provider}'. Implement a StorageAdapter for this provider.`);
    }

    singletonAdapter = new TelegramStorageAdapter();
    return singletonAdapter;
};
