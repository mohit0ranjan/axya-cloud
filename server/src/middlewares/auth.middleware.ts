import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import pool from '../config/db';
import { sendApiError } from '../utils/apiError';
import { decryptSession } from '../utils/sessionEncryption';

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) throw new Error('FATAL: JWT_SECRET environment variable is not set. Server cannot start safely.');

export interface AuthRequest extends Request {
    user?: {
        id: string;
        phone: string;
        sessionString: string;
    };
}

export const requireAuth = async (req: AuthRequest, res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization;
    const bearer = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : '';
    const cookieToken = req.signedCookies?.axya_session;
    if (!bearer && !cookieToken) {
        return sendApiError(res, 401, 'unauthorized', 'Unauthorized: Missing or invalid token format', { retryable: false });
    }

    if (!bearer && !['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
        const origins = String(process.env.ALLOWED_ORIGINS || '').split(',').map(value => value.trim());
        if (!req.headers.origin || !origins.includes(req.headers.origin)) {
            return sendApiError(res, 403, 'forbidden', 'This browser origin is not authorized', { retryable: false });
        }
    }
    const token = bearer || cookieToken;

    try {
        const decoded = jwt.verify(token, JWT_SECRET) as { userId: string; purpose?: string };
        if (typeof decoded.userId !== 'string' || (decoded.purpose && decoded.purpose !== 'access')) {
            return sendApiError(res,401,'unauthorized','This token does not authorise private drive access.');
        }

        const userResult = await pool.query('SELECT id, phone, session_string FROM users WHERE id = $1', [decoded.userId]);

        if (userResult.rows.length === 0) {
            return sendApiError(res, 401, 'unauthorized', 'Unauthorized: Requesting user not found in database', { retryable: false });
        }

        req.user = {
            id: userResult.rows[0].id,
            phone: userResult.rows[0].phone,
            sessionString: decryptSession(userResult.rows[0].session_string),
        };

        next();
    } catch (error) {
        if (error instanceof jwt.JsonWebTokenError) {
            return sendApiError(res, 401, 'unauthorized', 'Your session has expired. Please sign in again.', { retryable: false });
        }
        return sendApiError(res, 503, 'auth_unavailable', 'Cannot verify your session right now. Please retry.', { retryable: true });
    }
};
