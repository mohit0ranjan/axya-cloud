import { CustomFile } from 'telegram/client/uploads';
import { Api } from 'telegram';
import crypto from 'crypto';
import bigInt from 'big-integer';
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
    // New uploads always use the owner's account. Legacy shared sessions are read-only fallbacks.
    const sessionCandidates = [String(ownerSessionString || '').trim()].filter(Boolean);

    const uniqueSessions = Array.from(new Set(sessionCandidates));
    return uniqueSessions.map((session) => {
        const targetChatId = requested || 'me';

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
            const client = await getDynamicClient(candidate.session);
            if (candidate.chatId !== 'me') {
                const entity = await client.getEntity(candidate.chatId);
                if (entity instanceof Api.Channel && entity.broadcast && !entity.creator && !entity.adminRights?.postMessages) throw new Error('Your Telegram account needs permission to post files in this channel.');
                if (entity instanceof Api.Channel && (entity.left || entity.restricted)) throw new Error('This Telegram channel is unavailable to your account.');
            }
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
    operation: () => Promise<any>,
    maxRetries = 3
): Promise<any> => {
    for (let attempt = 0; attempt < maxRetries; attempt += 1) {
        try {
            return await operation();
        } catch (error: any) {
            const raw = String(error?.message || '');

            if (/AUTH_KEY|SESSION_REVOKED|SESSION_EXPIRED|USER_DEACTIVATED|PHONE_MIGRATE/i.test(raw)) {
                throw new Error('SESSION_EXPIRED: Please log in to Telegram again.');
            }

            if (raw.includes('FLOOD_WAIT') || raw.includes('FLOOD')) {
                const waitSec = Number(error?.seconds) || Number(raw.match(/FLOOD(?:_PREMIUM)?_WAIT_?(\d+)/i)?.[1]) || 15;
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

        const operationId = request.idempotencyKey || crypto.randomUUID();
        const marker = '#axya_' + operationId.replace(/[^a-zA-Z0-9]/g, '');
        const peer = await client.getInputEntity(target.chatId);
        const lookup = async () => {
            const messages = await client.getMessages(peer, { search: marker, limit: 10 });
            return messages.find((message: any) => message.document && String(message.message || '').includes(marker));
        };
        // Reconcile delivery after a crash between Telegram acknowledgement and
        // the database checkpoint. The lookup is scoped to the owner's target.
        let uploadedMessage: any = request.idempotencyKey ? await lookup() : undefined;
        if (!uploadedMessage) {
            const deadlineMs = Math.max(30 * 60_000, (request.fileSize / (256 * 1024)) * 1000);
            const deadline = Date.now() + deadlineMs;
            const progress = (fraction: number) => {
                if (Date.now() >= deadline) throw new Error('TELEGRAM_UPLOAD_TIMEOUT');
                request.onProgress?.(Math.max(0, Math.min(1, Number(fraction || 0))));
            };
            // A stable MTProto random_id prevents retries from sending a second
            // message if the original send succeeded but its response was lost.
            const randomId = bigInt(crypto.createHash('sha256').update(operationId).digest().readBigInt64LE(0).toString());
            uploadedMessage = await uploadToTelegramWithRetry(client, target.chatId, async () => {
                const recovered = request.idempotencyKey ? await lookup() : undefined;
                if (recovered) return recovered;
                const file = await client.uploadFile({ file: customFile,
                    workers: request.fileSize > 500 * 1024 * 1024 ? 2 : 4, onProgress: progress });
                const media = new Api.InputMediaUploadedDocument({ file, mimeType: request.mimeType,
                    attributes: [new Api.DocumentAttributeFilename({ fileName: request.fileName })] });
                const send = new Api.messages.SendMedia({ peer, media,
                    message: (request.caption || '[Axya] ' + request.fileName) + '\n' + marker, randomId });
                try {
                    const result = await client.invoke(send);
                    return (client as any)._getResponseMessage(send, result, peer) || await lookup();
                } catch (error: any) {
                    if (/RANDOM_ID_DUPLICATE/.test(String(error?.message || ''))) {
                        const existing = await lookup();
                        if (existing) return existing;
                    }
                    throw error;
                }
            }, 3);
        }

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
