import crypto from 'crypto';
import { Request } from 'express';

const UPLOAD_RESUME_TOKEN_TTL_MS = Number.parseInt(String(process.env.UPLOAD_RESUME_TOKEN_TTL_MS || String(6 * 60 * 60 * 1000)), 10) || (6 * 60 * 60 * 1000);
const UPLOAD_RESUME_TOKEN_SECRET = String(process.env.UPLOAD_RESUME_TOKEN_SECRET || process.env.JWT_SECRET || crypto.randomUUID());
const HMAC_ALG = 'sha256';

export const signUploadResumeToken = (userId: string, uploadId: string): string => {
    const expiresAt = Date.now() + UPLOAD_RESUME_TOKEN_TTL_MS;
    const payload = `${userId}:${uploadId}:${expiresAt}`;
    const signature = crypto.createHmac(HMAC_ALG, UPLOAD_RESUME_TOKEN_SECRET).update(payload).digest('hex');
    return Buffer.from(`${payload}:${signature}`).toString('base64url');
};

export const verifyUploadResumeToken = (token: string): { userId: string; uploadId: string; expiresAt: number } | null => {
    try {
        const raw = Buffer.from(token, 'base64url').toString('utf8');
        const parts = raw.split(':');
        if (parts.length < 4) return null;

        const signature = parts.pop()!;
        const payload = parts.join(':');
        const [userId, uploadId, expiresAtRaw] = parts;
        if (!userId || !uploadId || !expiresAtRaw) return null;

        const expected = crypto.createHmac(HMAC_ALG, UPLOAD_RESUME_TOKEN_SECRET).update(`${userId}:${uploadId}:${expiresAtRaw}`).digest('hex');
        if (!crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature))) return null;

        const expiresAt = Number.parseInt(expiresAtRaw, 10);
        if (!Number.isFinite(expiresAt) || Date.now() >= expiresAt) return null;

        return { userId, uploadId, expiresAt };
    } catch {
        return null;
    }
};

export const getResumeTokenFromRequest = (req: Request): string | null => {
    const fromBody = String((req.body as any)?.resumeToken || '').trim();
    if (fromBody) return fromBody;
    const fromHeader = String(req.headers['x-upload-resume-token'] || '').trim();
    if (fromHeader) return fromHeader;
    const fromQuery = String((req.query as any)?.resume_token || '').trim();
    return fromQuery || null;
};
