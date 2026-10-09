import jwt from 'jsonwebtoken';
import crypto from 'crypto';

const audience = 'axya-private-video';
export const MEDIA_TICKET_SECONDS = 3600;
type MediaTicket = { purpose: 'media'; userId: string; fileId: string; revision: string };
const secret = () => {
    if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET is required');
    return process.env.JWT_SECRET;
};
export const mediaRevision = (chat: string, message: string) =>
    crypto.createHash('sha256').update(`${chat}:${message}`).digest('hex').slice(0, 20);

/** A playback capability cannot be used as an account access token. */
export const signMediaTicket = (userId: string, fileId: string, revision: string) =>
    jwt.sign({ purpose: 'media', userId, fileId, revision } satisfies MediaTicket, secret(), {
        algorithm: 'HS256', audience, expiresIn: MEDIA_TICKET_SECONDS,
    });

export const verifyMediaTicket = (token: string, fileId: string): MediaTicket | null => {
    try {
        const value = jwt.verify(token, secret(), { algorithms: ['HS256'], audience }) as MediaTicket;
        if (value.purpose !== 'media' || value.fileId !== fileId || typeof value.userId !== 'string'
            || !value.userId || !/^[a-f0-9]{20}$/.test(value.revision)) return null;
        return value;
    } catch { return null; }
};
