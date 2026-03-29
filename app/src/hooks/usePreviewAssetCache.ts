import { useEffect, useMemo, useState } from 'react';
import { InteractionManager, Platform } from 'react-native';
import { getCachedPreviewAssetUri, resolvePreviewAssetUri, warmPreviewAssetUri } from '../utils/previewCache';

type PreviewAssetOptions = {
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
    const headers = useMemo(() => ({ Authorization: `Bearer ${jwt}` }), [jwt]);
    const previewIsImage = isImageMime(mimeType);
    const [cacheVersion, setCacheVersion] = useState(0);

    const thumbUri = useMemo(() => (
        getCachedPreviewAssetUri(baseUrl, fileId, 'thumbnail', { width: thumbWidth, mimeType: 'image/webp' }) ||
        resolvePreviewAssetUri(baseUrl, fileId, 'thumbnail', { width: thumbWidth, mimeType: 'image/webp' })
    ), [baseUrl, cacheVersion, fileId, retryNonce, thumbWidth]);

    const activeUri = useMemo(() => (
        isCurrent
            ? (getCachedPreviewAssetUri(baseUrl, fileId, 'download', { mimeType: String(mimeType || '') }) ||
                resolvePreviewAssetUri(baseUrl, fileId, 'download', { mimeType: String(mimeType || '') }))
            : thumbUri
    ), [baseUrl, fileId, isCurrent, mimeType, retryNonce, thumbUri, cacheVersion]);

    useEffect(() => {
        if (!shouldLoad || !jwt) return;

        let cancelled = false;
        const cancelWork = getLowPriorityHandle(() => {
            void (async () => {
                try {
                    const thumbResult = await warmPreviewAssetUri(baseUrl, fileId, jwt, 'thumbnail', {
                        width: thumbWidth,
                        mimeType: 'image/webp',
                    });

                    if (previewIsImage && shouldWarmFullAsset(isCurrent, mimeType, fileSizeBytes)) {
                        const fullResult = await warmPreviewAssetUri(baseUrl, fileId, jwt, 'download', {
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
    }, [baseUrl, fileId, fileSizeBytes, isCurrent, jwt, mimeType, previewIsImage, retryNonce, shouldLoad, thumbWidth]);

    return useMemo(() => ({
        headers,
        thumbSource: { uri: thumbUri, headers },
        activeSource: { uri: activeUri, headers },
        isImage: previewIsImage,
    }), [activeUri, headers, previewIsImage, thumbUri]);
}