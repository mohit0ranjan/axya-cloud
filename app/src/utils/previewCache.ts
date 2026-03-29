import { sanitizeRemoteUri } from './fileSafety';
import * as FileSystem from 'expo-file-system/legacy';

type CachedEntry<T> = {
    value: T;
    expiresAt: number;
};

const PREVIEW_DETAIL_TTL_MS = 5 * 60 * 1000;
const PREVIEW_ASSET_TTL_MS = 6 * 60 * 60 * 1000;
const previewDetailCache = new Map<string, CachedEntry<any>>();
const previewUrlCache = new Map<string, string>();
type PreviewAssetCacheEntry = CachedEntry<string> & {
    inflight?: Promise<string>;
};
const previewAssetCache = new Map<string, PreviewAssetCacheEntry>();
const PREVIEW_CACHE_DIR = `${FileSystem.cacheDirectory || ''}axya-preview-cache`;

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

const buildPreviewUrl = (baseUrl: string, fileId: string | number, action: 'thumbnail' | 'download' | 'stream', width?: number) => {
    const trimmedBase = String(baseUrl || '').replace(/\/$/, '');
    const encodedId = encodeURIComponent(String(fileId || '').trim());
    const suffix = action === 'thumbnail' && Number.isFinite(width) && Number(width) > 0
        ? `?w=${Math.max(64, Math.min(2048, Math.round(Number(width))))}`
        : '';
    return sanitizeRemoteUri(`${trimmedBase}/files/${encodedId}/${action}${suffix}`);
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

const getAssetRemoteUrl = (baseUrl: string, fileId: string | number, action: 'thumbnail' | 'download' | 'stream', width?: number) => {
    const urls = buildPreviewMediaUrls(baseUrl, fileId, { thumbWidth: width });
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
    return '.bin';
};

const assetCacheKey = (
    baseUrl: string,
    fileId: string | number,
    action: 'thumbnail' | 'download' | 'stream',
    width?: number,
    mimeType?: string
) => cacheKey(baseUrl, fileId, action, width || '', mimeType || '');

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
    options?: { width?: number; mimeType?: string }
) => {
    const key = assetCacheKey(baseUrl, fileId, action, options?.width, options?.mimeType);
    return getCachedAssetEntry(key)?.value || null;
};

export const resolvePreviewAssetUri = (
    baseUrl: string,
    fileId: string | number,
    action: 'thumbnail' | 'download' | 'stream',
    options?: { width?: number; mimeType?: string }
) => {
    return getCachedPreviewAssetUri(baseUrl, fileId, action, options) || getAssetRemoteUrl(baseUrl, fileId, action, options?.width);
};

export const warmPreviewAssetUri = async (
    baseUrl: string,
    fileId: string | number,
    jwt: string,
    action: 'thumbnail' | 'download' | 'stream',
    options?: { width?: number; mimeType?: string }
) => {
    const key = assetCacheKey(baseUrl, fileId, action, options?.width, options?.mimeType);
    const existing = previewAssetCache.get(key);
    if (existing?.inflight) return existing.inflight;

    const remoteUrl = getAssetRemoteUrl(baseUrl, fileId, action, options?.width);
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
    options?: { thumbWidth?: number }
) => {
    const thumbWidth = Math.max(64, Math.min(2048, Math.round(options?.thumbWidth || 480)));
    const key = cacheKey(baseUrl, fileId, thumbWidth);

    const cached = previewUrlCache.get(key);
    if (cached) {
        return {
            thumbUrl: cached,
            downloadUrl: buildPreviewUrl(baseUrl, fileId, 'download'),
            streamUrl: buildPreviewUrl(baseUrl, fileId, 'stream'),
        };
    }

    const thumbUrl = buildPreviewUrl(baseUrl, fileId, 'thumbnail', thumbWidth);
    previewUrlCache.set(key, thumbUrl);

    return {
        thumbUrl,
        downloadUrl: buildPreviewUrl(baseUrl, fileId, 'download'),
        streamUrl: buildPreviewUrl(baseUrl, fileId, 'stream'),
    };
};
