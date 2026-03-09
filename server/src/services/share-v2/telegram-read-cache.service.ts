import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import NodeCache from 'node-cache';

type CacheState = 'hot' | 'warm' | 'miss';

type CacheEntry = {
    key: string;
    preferred_session_hash: string;
    updated_at: number;
    last_hit_at: number;
    hits: number;
    last_status: 'ok' | 'error';
};

const MEMORY_TTL_SECONDS = Math.max(60, Number.parseInt(String(process.env.TELEGRAM_READ_CACHE_TTL_SECONDS || '1800'), 10) || 1800);
const DISK_TTL_MS = MEMORY_TTL_SECONDS * 1000 * 4;
const CACHE_FILE_DIR = path.join(os.tmpdir(), 'axya_telegram_cache');
const CACHE_FILE = path.join(CACHE_FILE_DIR, 'message_route_cache.json');

const memoryCache = new NodeCache({ stdTTL: MEMORY_TTL_SECONDS, checkperiod: 60, useClones: false });
const diskCache = new Map<string, CacheEntry>();

let flushTimer: NodeJS.Timeout | null = null;

const keyFor = (chatId: string, messageId: number): string => `${chatId}:${messageId}`;

const scheduleFlush = () => {
    if (flushTimer) return;
    flushTimer = setTimeout(() => {
        flushTimer = null;
        try {
            fs.mkdirSync(CACHE_FILE_DIR, { recursive: true });
            const payload = JSON.stringify({
                written_at: Date.now(),
                entries: Array.from(diskCache.values()),
            });
            fs.writeFileSync(CACHE_FILE, payload, 'utf8');
        } catch {
            // best effort
        }
    }, 750);
};

const pruneDiskCache = () => {
    const cutoff = Date.now() - DISK_TTL_MS;
    for (const [key, entry] of diskCache.entries()) {
        if (entry.updated_at < cutoff) {
            diskCache.delete(key);
        }
    }
};

const loadDiskCache = () => {
    try {
        if (!fs.existsSync(CACHE_FILE)) return;
        const raw = fs.readFileSync(CACHE_FILE, 'utf8');
        const parsed = JSON.parse(raw) as { entries?: CacheEntry[] };
        for (const entry of parsed.entries || []) {
            if (!entry || !entry.key || !entry.preferred_session_hash) continue;
            diskCache.set(entry.key, entry);
        }
        pruneDiskCache();
    } catch {
        // best effort
    }
};

loadDiskCache();

export const hashSessionForCache = (session: string): string =>
    crypto.createHash('sha256').update(session).digest('hex').slice(0, 16);

export const getPreferredSessionHash = (chatId: string, messageId: number): string | null => {
    const key = keyFor(chatId, messageId);
    const hot = memoryCache.get<string>(key);
    if (hot) return hot;

    const warm = diskCache.get(key);
    if (!warm) return null;

    if (Date.now() - warm.updated_at > DISK_TTL_MS) {
        diskCache.delete(key);
        return null;
    }

    memoryCache.set(key, warm.preferred_session_hash);
    return warm.preferred_session_hash;
};

export const rememberPreferredSession = (
    chatId: string,
    messageId: number,
    preferredSessionHash: string,
    status: 'ok' | 'error' = 'ok'
) => {
    const key = keyFor(chatId, messageId);
    memoryCache.set(key, preferredSessionHash);

    const now = Date.now();
    const prev = diskCache.get(key);
    const next: CacheEntry = {
        key,
        preferred_session_hash: preferredSessionHash,
        updated_at: now,
        last_hit_at: now,
        hits: (prev?.hits || 0) + 1,
        last_status: status,
    };

    diskCache.set(key, next);
    pruneDiskCache();
    scheduleFlush();
};

export const getMessageCacheState = (chatId: string, messageId: number): CacheState => {
    const key = keyFor(chatId, messageId);
    if (memoryCache.has(key)) return 'hot';

    const warm = diskCache.get(key);
    if (!warm) return 'miss';

    if (Date.now() - warm.updated_at > DISK_TTL_MS) {
        diskCache.delete(key);
        return 'miss';
    }

    return 'warm';
};

export const getReadReplicaCacheStats = () => {
    pruneDiskCache();
    return {
        memoryKeys: memoryCache.keys().length,
        diskKeys: diskCache.size,
        memoryTtlSeconds: MEMORY_TTL_SECONDS,
    };
};
