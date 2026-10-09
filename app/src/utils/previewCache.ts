import { Platform } from 'react-native';
import { sanitizeRemoteUri } from './fileSafety';
import * as FileSystem from 'expo-file-system/legacy';

type CachedEntry<T> = {
    value: T;
    expiresAt: number;
};

const PREVIEW_DETAIL_TTL_MS = 5 * 60 * 1000;
const PREVIEW_ASSET_TTL_MS = 6 * 60 * 60 * 1000;
const MAX_PREVIEW_CACHE_BYTES = 128 * 1024 * 1024;
const MAX_PREVIEW_MEMORY_ENTRIES = 400;
const previewDetailCache = new Map<string, CachedEntry<any>>();
const previewUrlCache = new Map<string, string>();
type PreviewAssetCacheEntry = CachedEntry<string> & {
    inflight?: Promise<string>;
};
const previewAssetCache = new Map<string, PreviewAssetCacheEntry>();
const PREVIEW_CACHE_DIR = Platform.OS === 'web' || !FileSystem.cacheDirectory ? '' : `${FileSystem.cacheDirectory}axya-preview-cache`;

const now = () => Date.now();

const cacheKey = (...parts: Array<string | number | boolean | null | undefined>) =>
    parts.map((part) => String(part ?? '')).join('|');

export const getCachedPreviewDetail = (fileId: string) => {
    const key = String(fileId || '').trim();
    if (!key) return null;

    const entry = previewDetailCache.get(key);
    if (!entry) return null;
    if (entry.expiresAt < now()) {
        previewDetailCache.delete(key);
        return null;
    }

    return entry.value;
};

export const setCachedPreviewDetail = (fileId: string, value: any) => {
    const key = String(fileId || '').trim();
    if (!key) return;

    previewDetailCache.set(key, {
        value,
        expiresAt: now() + PREVIEW_DETAIL_TTL_MS,
    });
};

export const clearCachedPreviewDetail = (fileId?: string) => {
    const key = String(fileId || '').trim();
    if (!key) {
        previewDetailCache.clear();
        return;
    }

    previewDetailCache.delete(key);
};

const buildPreviewUrl = (baseUrl: string, fileId: string | number, action: 'thumbnail' | 'download' | 'stream', width?: number, revision?: string) => {
    const trimmedBase = String(baseUrl || '').replace(/\/$/, '');
    const encodedId = encodeURIComponent(String(fileId || '').trim());
    const suffix = action === 'thumbnail' && Number.isFinite(width) && Number(width) > 0
        ? `?w=${Math.max(64, Math.min(2048, Math.round(Number(width))))}`
        : '';
    return sanitizeRemoteUri(`${trimmedBase}/files/${encodedId}/${action}${suffix}${revision ? `${suffix ? "&" : "?"}v=${encodeURIComponent(revision)}` : ""}`);
};

const safeAssetName = (key: string) => key.replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 180);

const ensurePreviewCacheDir = async () => {
    if (!PREVIEW_CACHE_DIR) return;
    try {
        await FileSystem.makeDirectoryAsync(PREVIEW_CACHE_DIR, { intermediates: true });
    } catch {
        // best effort
    }
};

let cachePrune: Promise<void> | null = null;
const prunePreviewCache = async (keepUri?: string) => {
    if (!PREVIEW_CACHE_DIR) return;
    if (cachePrune) await cachePrune;
    cachePrune = (async () => {
        try {
            const names = await FileSystem.readDirectoryAsync(PREVIEW_CACHE_DIR);
            const entries = await Promise.all(names.map(async (name) => {
                const uri = `${PREVIEW_CACHE_DIR}/${name}`;
                const info = await FileSystem.getInfoAsync(uri);
                return info.exists && !info.isDirectory
                    ? { uri, size: info.size || 0, modified: info.modificationTime || 0 }
                    : null;
            }));
            const files = entries.filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));
            let total = files.reduce((sum, file) => sum + file.size, 0);
            for (const file of files.sort((a, b) => a.modified - b.modified)) {
                const expired = !file.modified || Date.now() - file.modified * 1000 > PREVIEW_ASSET_TTL_MS;
                if ((expired || total > MAX_PREVIEW_CACHE_BYTES) && file.uri !== keepUri) {
                    await FileSystem.deleteAsync(file.uri, { idempotent: true });
                    total -= file.size;
                    for (const [key, entry] of previewAssetCache) {
                        if (entry.value === file.uri) previewAssetCache.delete(key);
                    }
                }
            }
        } catch {
            // Cache cleanup is best effort; a failed sweep must not block preview.
        }
    })();
    try { await cachePrune; } finally { cachePrune = null; }
};

const getAssetRemoteUrl = (baseUrl: string, fileId: string | number, action: 'thumbnail' | 'download' | 'stream', width?: number, revision?: string) => {
    const urls = buildPreviewMediaUrls(baseUrl, fileId, { thumbWidth: width, revision });
    if (action === 'download') return urls.downloadUrl;
    if (action === 'stream') return urls.streamUrl;
    return urls.thumbUrl;
};

const getAssetCacheExtension = (action: 'thumbnail' | 'download' | 'stream', mimeType?: string) => {
    if (action === 'thumbnail') return '.webp';
    const normalizedMime = String(mimeType || '').toLowerCase();
    if (normalizedMime === 'image/png') return '.png';
    if (normalizedMime === 'image/gif') return '.gif';
    if (normalizedMime === 'image/webp') return '.webp';
    if (normalizedMime === 'image/jpeg' || normalizedMime === 'image/jpg') return '.jpg';
    if (normalizedMime === 'application/pdf') return '.pdf';
    return '.bin';
};

const assetCacheKey = (
    baseUrl: string,
    fileId: string | number,
    action: 'thumbnail' | 'download' | 'stream',
    width?: number,
    mimeType?: string,
    revision?: string
) => cacheKey(baseUrl, fileId, action, revision || '', width || '', mimeType || '');

const getCachedAssetEntry = (key: string) => {
    const entry = previewAssetCache.get(key);
    if (!entry) return null;
    if (entry.expiresAt < now()) {
        previewAssetCache.delete(key);
        return null;
    }
    return entry;
};

export const getCachedPreviewAssetUri = (
    baseUrl: string,
    fileId: string | number,
    action: 'thumbnail' | 'download' | 'stream',
    options?: { width?: number; mimeType?: string; revision?: string }
) => {
    const key = assetCacheKey(baseUrl, fileId, action, options?.width, options?.mimeType, options?.revision);
    return getCachedAssetEntry(key)?.value || null;
};

export const resolvePreviewAssetUri = (
    baseUrl: string,
    fileId: string | number,
    action: 'thumbnail' | 'download' | 'stream',
    options?: { width?: number; mimeType?: string; revision?: string }
) => {
    return getCachedPreviewAssetUri(baseUrl, fileId, action, options) || getAssetRemoteUrl(baseUrl, fileId, action, options?.width, options?.revision);
};

export const warmPreviewAssetUri = async (
    baseUrl: string,
    fileId: string | number,
    jwt: string,
    action: 'thumbnail' | 'download' | 'stream',
    options?: { width?: number; mimeType?: string; revision?: string }
) => {
    const key = assetCacheKey(baseUrl, fileId, action, options?.width, options?.mimeType, options?.revision);
    const existing = previewAssetCache.get(key);
    if (existing?.inflight) return existing.inflight;

    const remoteUrl = getAssetRemoteUrl(baseUrl, fileId, action, options?.width, options?.revision);
    const cacheDir = PREVIEW_CACHE_DIR;
    const cacheFile = cacheDir
        ? `${cacheDir}/${safeAssetName(key)}${getAssetCacheExtension(action, options?.mimeType)}`
        : null;

    const inflight = (async () => {
        try {
            if (cacheFile) {
                await ensurePreviewCacheDir();
                const info = await FileSystem.getInfoAsync(cacheFile);
                if (info.exists && info.size && info.size > 0) {
                    const ageMs = info.modificationTime ? (Date.now() - info.modificationTime * 1000) : 0;
                    if (!ageMs || ageMs < PREVIEW_ASSET_TTL_MS) {
                        previewAssetCache.set(key, {
                            value: info.uri,
                            expiresAt: now() + PREVIEW_ASSET_TTL_MS,
                        });
                        return info.uri;
                    }
                }

                if (cacheFile) {
                    try {
                        await FileSystem.deleteAsync(cacheFile, { idempotent: true });
                    } catch {
                        // best effort
                    }
                }

                const downloaded = await FileSystem.downloadAsync(remoteUrl, cacheFile, {
                    headers: jwt ? { Authorization: `Bearer ${jwt}` } : undefined,
                });

                previewAssetCache.set(key, {
                    value: downloaded.uri,
                    expiresAt: now() + PREVIEW_ASSET_TTL_MS,
                });
                void prunePreviewCache(downloaded.uri);
                return downloaded.uri;
            }

            return remoteUrl;
        } catch {
            previewAssetCache.delete(key);
            return remoteUrl;
        }
    })();

    previewAssetCache.set(key, {
        value: existing?.value || remoteUrl,
        expiresAt: now() + PREVIEW_ASSET_TTL_MS,
        inflight,
    });

    return inflight;
};

export const invalidatePreviewAssetCache = (baseUrl: string, fileId: string | number) => {
    const idPrefix = `${String(baseUrl || '').trim()}|${String(fileId || '').trim()}|`;
    for (const key of previewAssetCache.keys()) {
        if (key.startsWith(idPrefix)) {
            const entry = previewAssetCache.get(key);
            if (entry?.value && String(entry.value).startsWith('file://')) {
                FileSystem.deleteAsync(entry.value, { idempotent: true }).catch(() => undefined);
            }
            previewAssetCache.delete(key);
        }
    }
};

export const buildPreviewMediaUrls = (
    baseUrl: string,
    fileId: string | number,
    options?: { thumbWidth?: number; revision?: string }
) => {
    const thumbWidth = Math.max(64, Math.min(2048, Math.round(options?.thumbWidth || 480)));
    const key = cacheKey(baseUrl, fileId, thumbWidth, options?.revision);

    const cached = previewUrlCache.get(key);
    if (cached) {
        return {
            thumbUrl: cached,
            downloadUrl: buildPreviewUrl(baseUrl, fileId, 'download', undefined, options?.revision),
            streamUrl: buildPreviewUrl(baseUrl, fileId, 'stream', undefined, options?.revision),
        };
    }

    const thumbUrl = buildPreviewUrl(baseUrl, fileId, 'thumbnail', thumbWidth, options?.revision);
    previewUrlCache.set(key, thumbUrl);
    if (previewUrlCache.size > MAX_PREVIEW_MEMORY_ENTRIES) previewUrlCache.delete(previewUrlCache.keys().next().value!);

    return {
        thumbUrl,
        downloadUrl: buildPreviewUrl(baseUrl, fileId, 'download', undefined, options?.revision),
        streamUrl: buildPreviewUrl(baseUrl, fileId, 'stream', undefined, options?.revision),
    };
};
