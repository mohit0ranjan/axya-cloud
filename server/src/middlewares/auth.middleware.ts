import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import pool from '../config/db';
import { sendApiError } from '../utils/apiError';

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
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return sendApiError(res, 401, 'unauthorized', 'Unauthorized: Missing or invalid token format', { retryable: false });
    }

    const token = authHeader.split(' ')[1];

    try {
        const decoded = jwt.verify(token, JWT_SECRET) as { userId: string };

        const userResult = await pool.query('SELECT id, phone, session_string FROM users WHERE id = $1', [decoded.userId]);

        if (userResult.rows.length === 0) {
            return sendApiError(res, 401, 'unauthorized', 'Unauthorized: Requesting user not found in database', { retryable: false });
        }

        req.user = {
            id: userResult.rows[0].id,
            phone: userResult.rows[0].phone,
            sessionString: userResult.rows[0].session_string,
        };

        next();
    } catch {
        return sendApiError(res, 401, 'unauthorized', 'Unauthorized: Invalid token payload', { retryable: false });
    }
};
