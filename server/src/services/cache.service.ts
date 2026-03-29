import NodeCache from 'node-cache';

type CacheValue = unknown;

const DEFAULT_TTL_SECONDS = Number.parseInt(String(process.env.CACHE_DEFAULT_TTL_SECONDS || '45'), 10) || 45;

const cache = new NodeCache({
    stdTTL: Math.max(5, DEFAULT_TTL_SECONDS),
    checkperiod: 60,
    useClones: false,
    deleteOnExpire: true,
});

export const cacheGet = <T = CacheValue>(key: string): T | undefined => {
    return cache.get<T>(key);
};

export const cacheSet = <T = CacheValue>(key: string, value: T, ttlSeconds?: number): boolean => {
    const ttl = typeof ttlSeconds === 'number' && Number.isFinite(ttlSeconds)
        ? Math.max(1, Math.floor(ttlSeconds))
        : undefined;
    if (typeof ttl === 'number') {
        return cache.set<T>(key, value, ttl);
    }
    return cache.set<T>(key, value);
};

export const cacheDel = (key: string): number => {
    return cache.del(key);
};

export const cacheDelByPrefix = (prefix: string): number => {
    if (!prefix) return 0;
    const keys = cache.keys().filter((key) => key.startsWith(prefix));
    if (!keys.length) return 0;
    return cache.del(keys);
};

export const cacheStats = () => cache.getStats();
