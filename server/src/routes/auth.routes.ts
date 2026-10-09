import express from 'express';
import { sendCode, verifyCode, getMe, deleteAccount, createBrowserSession } from '../controllers/auth.controller';
import { requireAuth } from '../middlewares/auth.middleware';

const router = express.Router();

router.post('/send-code', sendCode);
router.post('/verify-code', verifyCode);
router.get('/me', requireAuth, getMe);
router.post('/browser-session', requireAuth, createBrowserSession);
router.post('/logout', requireAuth, (_req, res) => {
    res.clearCookie('axya_session', { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/' });
    res.json({ success: true });
});
router.delete('/account', requireAuth, deleteAccount);  // ✅ protected account delete

export default router;
