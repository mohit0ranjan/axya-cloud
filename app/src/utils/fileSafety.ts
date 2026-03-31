export const safeDecode = (value: string): string => {
    const input = String(value || '');
    if (!input) return '';

    try {
        return decodeURIComponent(input);
    } catch {
        try {
            // Replace standalone % that aren't followed by 2 hex digits
            const escaped = input.replace(/%(?![0-9A-Fa-f]{2})/g, '%25');
            return decodeURIComponent(escaped);
        } catch {
            return input;
        }
    }
};

export const safeDecodeURIComponent = safeDecode;

export const sanitizeFileName = (value: string, fallback: string = 'file'): string => {
    const decoded = safeDecode(String(value || '').trim());
    const cleaned = decoded
        .replace(/[\/\\:*?"<>|#%\r\n\t]+/g, '_')
        .replace(/[^\w.\- ]+/g, '_')
        .replace(/\s+/g, ' ')
        .trim();

    return cleaned || fallback;
};

export const sanitizeDisplayName = (value: string, fallback: string = 'File'): string => {
    const cleaned = sanitizeFileName(value, fallback)
        .replace(/_/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    return cleaned || fallback;
};

export const sanitizeRemoteUri = (value: string): string => {
    const input = String(value || '').trim();
    if (!input) return '';

    const decoded = safeDecode(input);
    const escapedPercents = decoded.replace(/%(?![0-9A-Fa-f]{2})/g, '%25');

    try {
        return encodeURI(escapedPercents);
    } catch {
        console.warn('Invalid URI:', input);
        return escapedPercents;
    }
};

export const buildApiFileUrl = (baseUrl: string, fileId: string | number, action: string): string => {
    const trimmedBase = String(baseUrl || '').replace(/\/$/, '');
    const encodedId = encodeURIComponent(String(fileId || '').trim());
    return sanitizeRemoteUri(`${trimmedBase}/files/${encodedId}/${action}`);
};

export interface NormalizedUploadFile {
    uri: string;
    name: string;
    type: string;
}

export const normalizeUploadFile = (file: { uri?: string; name?: string; mimeType?: string; type?: string }): NormalizedUploadFile => {
    const rawUri = String(file?.uri || '').trim();
    const decodedUri = safeDecode(rawUri);
    const safeUri = sanitizeRemoteUri(decodedUri);
    const safeName = String(file?.name || 'file').replace(/[^\w.-]/g, '_') || 'file';
    const type = String(file?.mimeType || file?.type || 'application/octet-stream');

    return {
        uri: safeUri,
        name: safeName,
        type,
    };
};