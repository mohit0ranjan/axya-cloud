import { useEffect, useMemo, useState } from 'react';
import { InteractionManager, Platform } from 'react-native';
import { getCachedPreviewAssetUri, resolvePreviewAssetUri, warmPreviewAssetUri } from '../utils/previewCache';
import { useServerStatus } from '../context/ServerStatusContext';

type PreviewAssetOptions = {
    localUri?: string;
    revision?: string;
    baseUrl: string;
    fileId: string | number;
    jwt: string;
    retryNonce?: number;
    mimeType?: string | null;
    fileSizeBytes?: number;
    isCurrent: boolean;
    shouldLoad: boolean;
    thumbWidth: number;
};

const getLowPriorityHandle = (work: () => void) => {
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
        const requestIdle = (window as Window & { requestIdleCallback?: any }).requestIdleCallback;
        const cancelIdle = (window as Window & { cancelIdleCallback?: any }).cancelIdleCallback;

        if (requestIdle) {
            const id = requestIdle(() => work(), { timeout: 750 });
            return () => {
                if (cancelIdle) cancelIdle(id);
            };
        }
    }

    const task = InteractionManager.runAfterInteractions(work);
    return () => {
        task.cancel?.();
    };
};

const isImageMime = (mimeType?: string | null) => String(mimeType || '').startsWith('image/');

const shouldWarmFullAsset = (isCurrent: boolean, mimeType?: string | null, fileSizeBytes?: number) => {
    if (!isImageMime(mimeType)) return false;
    if (isCurrent) return true;
    if (!Number.isFinite(fileSizeBytes)) return true;
    return Number(fileSizeBytes || 0) <= 20 * 1024 * 1024;
};

export function usePreviewAssetCache({
    localUri,
    revision,
    baseUrl,
    fileId,
    jwt,
    retryNonce,
    mimeType,
    fileSizeBytes,
    isCurrent,
    shouldLoad,
    thumbWidth,
}: PreviewAssetOptions) {
    const { isWaking } = useServerStatus();
    const headers = useMemo(() => ({ Authorization: `Bearer ${jwt}` }), [jwt]);
    const previewIsImage = isImageMime(mimeType);
    const [cacheVersion, setCacheVersion] = useState(0);

    const thumbUri = useMemo(() => (
        getCachedPreviewAssetUri(baseUrl, fileId, 'thumbnail', { revision, width: thumbWidth, mimeType: 'image/webp' }) ||
        resolvePreviewAssetUri(baseUrl, fileId, 'thumbnail', { revision, width: thumbWidth, mimeType: 'image/webp' })
    ), [revision, baseUrl, cacheVersion, fileId, retryNonce, thumbWidth]);

    const previewWidth = Platform.OS === 'web' ? 2048 : 1080;
    const activeUri = useMemo(() => {
        if (!isCurrent) return thumbUri;
        if (previewIsImage) {
            if (Number(fileSizeBytes || 0) <= 20 * 1024 * 1024) {
                return getCachedPreviewAssetUri(baseUrl, fileId, "download", { revision, mimeType: String(mimeType || "") }) || resolvePreviewAssetUri(baseUrl, fileId, "download", { revision, mimeType: String(mimeType || "") });
            }
            return getCachedPreviewAssetUri(baseUrl, fileId, 'thumbnail', { revision, width: previewWidth, mimeType: 'image/webp' }) ||
                resolvePreviewAssetUri(baseUrl, fileId, 'thumbnail', { revision, width: previewWidth, mimeType: 'image/webp' });
        }
        return getCachedPreviewAssetUri(baseUrl, fileId, 'download', { revision, mimeType: String(mimeType || '') }) ||
            resolvePreviewAssetUri(baseUrl, fileId, 'download', { revision, mimeType: String(mimeType || '') });
    }, [revision, baseUrl, fileId, isCurrent, mimeType, previewIsImage, previewWidth, thumbUri, cacheVersion, fileSizeBytes]);

    useEffect(() => {
        if (localUri || !shouldLoad || !jwt) return;

        let cancelled = false;
        const cancelWork = getLowPriorityHandle(() => {
            void (async () => {
                try {
                    const thumbResult = await warmPreviewAssetUri(baseUrl, fileId, jwt, 'thumbnail', {
                        revision,
                        width: thumbWidth,
                        mimeType: 'image/webp',
                    });

                    if (previewIsImage && shouldWarmFullAsset(isCurrent, mimeType, fileSizeBytes)) {
                        const fullResult = await warmPreviewAssetUri(baseUrl, fileId, jwt, 'download', {
                            revision,
                            mimeType: String(mimeType || ''),
                        });
                        if (!cancelled) {
                            setCacheVersion((version) => version + 1);
                        }
                        return fullResult;
                    }

                    if (!cancelled) {
                        setCacheVersion((version) => version + 1);
                    }

                    return thumbResult;
                } catch {
                    // best effort warmup; remote fallbacks remain available
                }
            })();
        });

        return () => {
            cancelled = true;
            cancelWork();
        };
    }, [revision, localUri, baseUrl, fileId, fileSizeBytes, isCurrent, isWaking, jwt, mimeType, previewIsImage, retryNonce, shouldLoad, thumbWidth]);

    return useMemo(() => ({
        headers,
        thumbSource: { uri: localUri || thumbUri, headers: localUri ? {} : headers },
        activeSource: { uri: localUri || activeUri, headers: localUri ? {} : headers },
        isImage: previewIsImage,
    }), [localUri, activeUri, headers, previewIsImage, thumbUri]);
}
