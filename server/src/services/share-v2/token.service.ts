import crypto from 'crypto';
import jwt from 'jsonwebtoken';

export type ShareV2SessionPayload = {
    typ: 'share_v2_session';
    shareId: string;
    sid: string;
};

export type ShareV2TicketPayload = {
    typ: 'share_v2_ticket';
    shareId: string;
    itemId: string;
    disposition: 'inline' | 'attachment' | 'thumbnail';
};

const SESSION_SECRET = process.env.SHARE_V2_SESSION_SECRET || process.env.JWT_SECRET || 'share_v2_session_secret';
const TICKET_SECRET = process.env.SHARE_V2_TICKET_SECRET || process.env.JWT_SECRET || 'share_v2_ticket_secret';
const LINK_PEPPER = process.env.SHARE_V2_LINK_PEPPER || process.env.JWT_SECRET || 'share_v2_link_pepper';

const SESSION_TTL_SECONDS = Number.parseInt(String(process.env.SHARE_V2_SESSION_TTL_SECONDS || '1800'), 10) || 1800;
const TICKET_TTL_SECONDS = Number.parseInt(String(process.env.SHARE_V2_TICKET_TTL_SECONDS || '120'), 10) || 120;

const toBase64Url = (buf: Buffer): string => buf.toString('base64url');

export const generateSlug = (bytes = 9): string => {
    // Base64url, lowercase + alnum to keep URLs neat.
    return toBase64Url(crypto.randomBytes(bytes)).replace(/[^a-zA-Z0-9]/g, '').slice(0, 12);
};

export const generateLinkSecret = (): string => toBase64Url(crypto.randomBytes(32));

export const hashLinkSecret = (secret: string): string => {
    return crypto.createHash('sha256').update(`${String(secret)}${LINK_PEPPER}`).digest('hex');
};

export const hashSessionToken = (token: string): string => {
    return crypto.createHash('sha256').update(String(token)).digest('hex');
};

export const constantTimeEqualsHex = (aHex: string, bHex: string): boolean => {
    const a = Buffer.from(String(aHex || ''), 'hex');
    const b = Buffer.from(String(bHex || ''), 'hex');
    if (a.length === 0 || b.length === 0 || a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
};

export const signShareV2SessionToken = (payload: Omit<ShareV2SessionPayload, 'typ'>): string => {
    return jwt.sign({ typ: 'share_v2_session', ...payload } satisfies ShareV2SessionPayload, SESSION_SECRET, {
        expiresIn: SESSION_TTL_SECONDS,
    });
};

export const verifyShareV2SessionToken = (token: string): ShareV2SessionPayload | null => {
    try {
        const payload = jwt.verify(token, SESSION_SECRET) as ShareV2SessionPayload;
        if (!payload || payload.typ !== 'share_v2_session' || !payload.shareId || !payload.sid) return null;
        return payload;
    } catch {
        return null;
    }
};

export const signShareV2Ticket = (payload: Omit<ShareV2TicketPayload, 'typ'>): string => {
    return jwt.sign({ typ: 'share_v2_ticket', ...payload } satisfies ShareV2TicketPayload, TICKET_SECRET, {
        expiresIn: TICKET_TTL_SECONDS,
    });
};

export const verifyShareV2Ticket = (token: string): ShareV2TicketPayload | null => {
    try {
        const payload = jwt.verify(token, TICKET_SECRET) as ShareV2TicketPayload;
        if (!payload || payload.typ !== 'share_v2_ticket' || !payload.shareId || !payload.itemId) return null;
        if (payload.disposition !== 'inline' && payload.disposition !== 'attachment' && payload.disposition !== 'thumbnail') return null;
        return payload;
    } catch {
        return null;
    }
};

export const getSessionTtlSeconds = (): number => SESSION_TTL_SECONDS;
