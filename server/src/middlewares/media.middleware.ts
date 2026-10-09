import { Response, NextFunction } from 'express';
import { AuthRequest } from './auth.middleware';
import { verifyMediaTicket } from '../utils/mediaTicket';
import { decryptSession } from '../utils/sessionEncryption';
import { sendApiError } from '../utils/apiError';
import pool from '../config/db';

export interface MediaRequest extends AuthRequest { mediaRevision?: string }
export const requireMediaTicket = async (req: MediaRequest, res: Response, next: NextFunction) => {
    res.set({ 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer' });
    const ticket = typeof req.query.ticket === 'string' ? verifyMediaTicket(req.query.ticket, String(req.params.id)) : null;
    if (!ticket) return sendApiError(res, 401, 'playback_expired', 'Video access expired. Retry playback.');
    try {
        const result = await pool.query('SELECT id, phone, session_string FROM users WHERE id = $1', [ticket.userId]);
        if (!result.rows.length) return sendApiError(res, 401, 'unauthorized', 'Please sign in again.');
        req.user = { id: result.rows[0].id, phone: result.rows[0].phone, sessionString: decryptSession(result.rows[0].session_string) };
        req.mediaRevision = ticket.revision;
        next();
    } catch { return sendApiError(res, 503, 'auth_unavailable', 'Cannot verify playback access. Please retry.', { retryable: true }); }
};
