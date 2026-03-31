import fs from 'fs';
import crypto from 'crypto';
import { logger } from '../../utils/logger';

// ─── Logging ────────────────────────────────────────────────────────────────

export const logUploadStage = (event: string, details: Record<string, unknown>) => {
    logger.info('backend.upload', event, {
        at: new Date().toISOString(),
        ...details,
    });
};

// ─── Pure helpers ───────────────────────────────────────────────────────────

export const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

export const toInt = (value: unknown): number => {
    if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
    const parsed = Number.parseInt(String(value ?? ''), 10);
    return Number.isFinite(parsed) ? parsed : 0;
};

export const sanitizeUploadFileName = (value: string) =>
    String(value || '')
        .replace(/[\\/]/g, '_')
        .replace(/\s+/g, ' ')
        .trim() || 'upload.bin';

export const parseContentLengthHeader = (value: unknown): number | null => {
    const parsed = Number.parseInt(String(value ?? '').trim(), 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return null;
    return parsed;
};

// ─── Chunk parsing ──────────────────────────────────────────────────────────

export const parseUploadedChunks = (value: unknown): number[] => {
    let source: unknown[] = [];
    if (Array.isArray(value)) {
        source = value;
    } else if (typeof value === 'string') {
        try {
            const parsed = JSON.parse(value || '[]');
            source = Array.isArray(parsed) ? parsed : [];
        } catch {
            source = [];
        }
    }
    const out = new Set<number>();
    for (const raw of source) {
        const parsed = toInt(raw);
        if (parsed >= 0) out.add(parsed);
    }
    return [...out].sort((a, b) => a - b);
};

export const computeNextExpectedChunk = (totalChunks: number, uploadedChunks: number[]): number => {
    const uploaded = new Set(uploadedChunks);
    for (let i = 0; i < totalChunks; i += 1) {
        if (!uploaded.has(i)) return i;
    }
    return totalChunks;
};

export const computeMissingChunks = (totalChunks: number, uploadedChunks: number[]): number[] => {
    const seen = new Set(uploadedChunks);
    const missing: number[] = [];
    for (let i = 0; i < totalChunks; i += 1) {
        if (!seen.has(i)) missing.push(i);
    }
    return missing;
};

// ─── Hashing ────────────────────────────────────────────────────────────────

export const sha256Hex = (buffer: Buffer): string => crypto.createHash('sha256').update(buffer).digest('hex');

export const computeFileHashes = async (filePath: string): Promise<{ sha256: string; md5: string }> => {
    return new Promise((resolve, reject) => {
        const sha256 = crypto.createHash('sha256');
        const md5 = crypto.createHash('md5');
        const stream = fs.createReadStream(filePath);

        stream.on('data', (chunk) => {
            sha256.update(chunk);
            md5.update(chunk);
        });
        stream.on('end', () => {
            resolve({
                sha256: sha256.digest('hex'),
                md5: md5.digest('hex'),
            });
        });
        stream.on('error', reject);
    });
};

export const computePartialFileSha256 = async (filePath: string, totalBytes: number, sampleBytes = 2 * 1024 * 1024): Promise<string> => {
    const fileSize = Math.max(0, totalBytes);
    const headSize = Math.min(sampleBytes, fileSize);
    const tailSize = fileSize > headSize ? Math.min(sampleBytes, fileSize - headSize) : 0;

    const hash = crypto.createHash('sha256');
    const handle = await fs.promises.open(filePath, 'r');
    try {
        if (headSize > 0) {
            const head = Buffer.allocUnsafe(headSize);
            const headRead = await handle.read(head, 0, headSize, 0);
            hash.update(head.subarray(0, headRead.bytesRead));
        }
        if (tailSize > 0) {
            const tail = Buffer.allocUnsafe(tailSize);
            const tailOffset = Math.max(0, fileSize - tailSize);
            const tailRead = await handle.read(tail, 0, tailSize, tailOffset);
            hash.update(tail.subarray(0, tailRead.bytesRead));
        }

        hash.update(Buffer.from(`:${fileSize}:${headSize}:${tailSize}`, 'utf8'));
        return hash.digest('hex');
    } finally {
        await handle.close();
    }
};

// ─── Error classification ───────────────────────────────────────────────────

export const classifyUploadFailure = (err: unknown) => {
    const raw = String((err as any)?.message || '');
    if (/AUTH_KEY|SESSION_REVOKED|SESSION_EXPIRED|USER_DEACTIVATED|PHONE_MIGRATE/i.test(raw)) {
        return {
            code: 'telegram_session_expired',
            message: 'Telegram session expired. Please re-login.',
            retryable: false,
        };
    }
    if (/FLOOD_WAIT|NETWORK|TIMEOUT|ECONNRESET|ETIMEDOUT/i.test(raw)) {
        return {
            code: 'telegram_transient',
            message: 'Telegram is temporarily unavailable. Please retry.',
            retryable: true,
        };
    }
    return {
        code: 'internal_error',
        message: raw || 'Upload failed',
        retryable: false,
    };
};
