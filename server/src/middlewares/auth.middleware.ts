import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import pool from '../config/db';

const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-key-teledrive';

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
        return res.status(401).json({ success: false, error: 'Unauthorized: Missing or invalid token format' });
    }

    const token = authHeader.split(' ')[1];

    try {
        const decoded = jwt.verify(token, JWT_SECRET) as { userId: string };

        const userResult = await pool.query('SELECT id, phone, session_string FROM users WHERE id = $1', [decoded.userId]);

        if (userResult.rows.length === 0) {
            return res.status(401).json({ success: false, error: 'Unauthorized: Requesting user not found in database' });
        }

        req.user = {
            id: userResult.rows[0].id,
            phone: userResult.rows[0].phone,
            sessionString: userResult.rows[0].session_string,
        };

        next();
    } catch (error) {
        return res.status(401).json({ success: false, error: 'Unauthorized: Invalid token payload' });
    }
};
