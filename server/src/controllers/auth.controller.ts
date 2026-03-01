import { Request, Response } from 'express';
import { generateOTP, verifyOTPAndSignIn } from '../services/telegram.service';
import pool from '../config/db';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-key-teledrive';

export const sendCode = async (req: Request, res: Response) => {
    const { phoneNumber } = req.body;
    if (!phoneNumber) {
        return res.status(400).json({ success: false, error: 'Phone number is required.' });
    }

    try {
        console.log(`📡 [Auth] Requesting code for: ${phoneNumber}`);
        const { phoneCodeHash, tempSession } = await generateOTP(phoneNumber);
        console.log(`✅ [Auth] Code sent successfully`);
        res.json({ success: true, phoneCodeHash, tempSession });
    } catch (err: any) {
        console.error('❌ [Auth Error] Telegram SendCode failed:', err);

        let errorMessage = err.message || 'Telegram connection failed';
        if (errorMessage.includes('API_ID_INVALID')) {
            errorMessage = 'Invalid Telegram API ID or Hash. Check your .env variables.';
        } else if (errorMessage.includes('PHONE_NUMBER_INVALID')) {
            errorMessage = 'The phone number format is invalid. Use international format (e.g., +1234567890).';
        }

        res.status(500).json({ success: false, error: errorMessage });
    }
};

export const verifyCode = async (req: Request, res: Response) => {
    const { phoneNumber, phoneCodeHash, phoneCode, tempSession } = req.body;

    if (!phoneNumber || !phoneCodeHash || !phoneCode || !tempSession) {
        return res.status(400).json({ success: false, error: 'Missing required credentials.' });
    }

    try {
        const { userSessionString, profileData } = await verifyOTPAndSignIn(phoneNumber, phoneCodeHash, phoneCode, tempSession);

        let userResult = await pool.query('SELECT id FROM users WHERE phone = $1', [phoneNumber]);
        let userId;

        if (userResult.rows.length === 0) {
            const insertResult = await pool.query(
                'INSERT INTO users (phone, session_string, name, username) VALUES ($1, $2, $3, $4) RETURNING id',
                [phoneNumber, userSessionString, profileData.name, profileData.username]
            );
            userId = insertResult.rows[0].id;
        } else {
            userId = userResult.rows[0].id;
            await pool.query('UPDATE users SET session_string = $1, name = $2, username = $3 WHERE id = $4', [userSessionString, profileData.name, profileData.username, userId]);
        }

        const token = jwt.sign({ userId }, JWT_SECRET, { expiresIn: '30d' });

        res.json({
            success: true,
            message: 'Successfully logged in. Token generated.',
            token,
            user: { id: userId, phone: phoneNumber, name: profileData.name, username: profileData.username }
        });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
};

export const getMe = async (req: any, res: Response) => {
    try {
        if (!req.user || !req.user.id) return res.status(401).json({ success: false, error: 'Unauthorized' });
        const userResult = await pool.query('SELECT id, phone, name, username, profile_pic FROM users WHERE id = $1', [req.user.id]);
        if (userResult.rows.length === 0) return res.status(404).json({ success: false, error: 'User not found' });
        res.json({ success: true, user: userResult.rows[0] });
    } catch (err) {
        res.status(500).json({ success: false, error: 'Server error' });
    }
};
