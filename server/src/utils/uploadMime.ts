export const ALLOWED_UPLOAD_MIME_PREFIXES = [
    'image/',
    'video/',
    'audio/',
    'application/pdf',
    'text/',
    'application/zip',
    'application/x-zip',
    'application/msword',
    'application/vnd.openxmlformats',
    'application/vnd.ms-',
    'application/json',
    'application/xml',
];

export const isAllowedUploadMime = (mime: string): boolean => {
    const normalized = String(mime || '').trim().toLowerCase();
    if (!normalized) return false;
    return ALLOWED_UPLOAD_MIME_PREFIXES.some((prefix) => normalized.startsWith(prefix));
};
