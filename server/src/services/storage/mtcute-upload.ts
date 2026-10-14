import crypto from 'crypto';
import bigInt from 'big-integer';
import { Api } from 'telegram';
import { LAYER } from 'telegram/tl/AllTLObjects';
import { getDynamicClient } from '../telegram.service';
import type { TelegramClient } from '@mtcute/node';
import { decryptSession } from '../../utils/sessionEncryption';
import { StorageUploadRequest } from './storage.adapter';

// Native ESM import avoids mtcute's deprecated CommonJS bundle, while keeping
// the existing server's module format. No database/session files are created.
const importEsm = new Function('name', 'return import(name)') as (name: string) => Promise<any>;
type Entry = { client: TelegramClient; users: number; idle?: NodeJS.Timeout };
const clients = new Map<string, Promise<Entry>>();
const bounded = (value: string | undefined, fallback: number, max: number) =>
    Math.min(max, Math.max(1, Number.isFinite(Number(value)) && value ? Math.floor(Number(value)) : fallback));

async function acquire(sessionString: string): Promise<Entry> {
    const session = decryptSession(sessionString);
    const key = crypto.createHash('sha256').update(session).digest('hex');
    let pending = clients.get(key);
    if (!pending) {
        pending = (async () => {
            const [mt, convert] = await Promise.all([importEsm('@mtcute/node'), importEsm('@mtcute/convert')]);
            const count = bounded(process.env.MTCUTE_UPLOAD_CONNECTIONS, 2, 4);
            const client: TelegramClient = new mt.TelegramClient({
                apiId: Number(process.env.TELEGRAM_API_ID), apiHash: process.env.TELEGRAM_API_HASH,
                storage: new mt.MemoryStorage(), updates: false, disableUpdates: true, logLevel: 0,
                // Shared auth keys must not change the negotiated response schema
                // behind the existing GramJS readers. Part RPCs are layer-stable.
                overrideLayer: LAYER,
                network: { connectionCount: (kind: string) => kind === 'upload' ? count : kind === 'main' ? 0 : 1 },
            });
            try {
                await client.importSession(convert.convertFromGramjsSession(session));
                const identity = await (await getDynamicClient(session)).getMe();
                await client.storage.self.store({ userId: Number(identity.id.toString()),
                    isBot: !!identity.bot, isPremium: !!identity.premium, usernames: [] });
                await client.connect();
                return { client, users: 0 };
            } catch (error) { await client.destroy().catch(() => {}); throw error; }
        })();
        clients.set(key, pending);
        pending.catch(() => { if (clients.get(key) === pending) clients.delete(key); });
    }
    const entry = await pending;
    if (entry.idle) clearTimeout(entry.idle);
    entry.users++;
    return entry;
}

export function toGramjsInputFile(raw: any): Api.TypeInputFile {
    const fields = { id: bigInt(raw.id.toString()), parts: raw.parts, name: raw.name };
    if (raw._ === 'inputFileBig') return new Api.InputFileBig(fields);
    if (raw._ === 'inputFile') return new Api.InputFile({ ...fields, md5Checksum: raw.md5Checksum || '' });
    throw new Error('MTCUTE_INVALID_FILE_HANDLE');
}

export async function uploadWithMtcute(request: StorageUploadRequest) {
    const entry = await acquire(request.ownerSessionString);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new Error('TELEGRAM_UPLOAD_TIMEOUT')),
        Math.max(30 * 60_000, request.fileSize / (256 * 1024) * 1000));
    timeout.unref();
    try {
        const uploaded = await entry.client.uploadFile({ file: request.filePath,
            fileName: request.fileName, fileSize: request.fileSize, fileMime: request.mimeType,
            partSize: 512, requestsPerConnection: bounded(process.env.MTCUTE_REQUESTS_PER_CONNECTION, 3, 4),
            abortSignal: controller.signal,
            progressCallback: (bytes: number) => request.onProgress?.(bytes / request.fileSize),
        });
        // SendMedia remains on the existing verified/idempotent GramJS path.
        // Both transports use the owner's auth key and Telegram file identifier.
        return toGramjsInputFile(uploaded.inputFile);
    } finally {
        controller.abort();
        clearTimeout(timeout);
        entry.users--;
        if (!entry.users) {
            entry.idle = setTimeout(() => {
                for (const [key, pending] of clients) void pending.then(value => {
                    if (value === entry && !entry.users && clients.get(key) === pending) {
                        clients.delete(key); void entry.client.destroy().catch(() => {});
                    }
                }).catch(() => {});
            }, 60_000);
            entry.idle.unref();
        }
    }
}
