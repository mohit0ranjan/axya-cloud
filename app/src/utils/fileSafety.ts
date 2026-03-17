export const safeDecodeURIComponent = (value: string): string => {
    const input = String(value || '');
    if (!input) return '';

    try {
        return decodeURIComponent(input);
    } catch {
        console.warn('Invalid URI:', input);
        return input;
    }
};

export const sanitizeFileName = (value: string, fallback: string = 'file'): string => {
    const decoded = safeDecodeURIComponent(String(value || '').trim());
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

    const decoded = safeDecodeURIComponent(input);
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