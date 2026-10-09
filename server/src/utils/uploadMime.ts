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
    // Storage accepts arbitrary file formats, including picker fallback MIME.
    // Preview support is a separate concern; never execute uploaded content.
    return /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/.test(normalized);
};

export const safeInlineMime = (mime: string): string => {
    const normalized = String(mime || '').trim().toLowerCase();
    return /^(image\/(jpeg|png|webp|gif|avif|bmp)|video\/[a-z0-9.+-]+|audio\/[a-z0-9.+-]+|application\/pdf)$/.test(normalized)
        ? normalized : 'application/octet-stream';
};
