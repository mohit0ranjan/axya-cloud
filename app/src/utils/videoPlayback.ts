export interface VideoPlayerProps {
    url: string;
    token: string;
    width: number;
    fileId?: string;
    onError?: (error: unknown) => void;
}
export const isLocalVideo = (url: string) => /^(file:|content:|blob:|data:)/i.test(url);
export const videoErrorMessage = (code?: number) => code === 3 || code === 4
    ? 'This video format could not be played. Download the original to open it in another player.'
    : 'Video could not load. Check your connection and retry.';

/** Preserve signed/opaque URIs. Never decode and re-encode a media source. */
export const webPlaybackUrl = (source: string, fileId: string, ticket: string) => {
    const url = new URL(source);
    const match = /\/files\/([^/]+)\/stream$/.exec(url.pathname);
    if (!['http:', 'https:'].includes(url.protocol) || !match || decodeURIComponent(match[1]) !== fileId || !ticket)
        throw new Error('Invalid private video source');
    url.pathname = url.pathname.replace(/\/files\/[^/]+\/stream$/, `/files/media/${encodeURIComponent(fileId)}`);
    url.search = '';
    url.hash = '';
    url.searchParams.set('ticket', ticket);
    return url.toString();
};
