import express from 'express';
import { sendCode, verifyCode, getMe, deleteAccount } from '../controllers/auth.controller';
import { requireAuth } from '../middlewares/auth.middleware';

const router = express.Router();

router.post('/send-code', sendCode);
router.post('/verify-code', verifyCode);
router.get('/me', requireAuth, getMe);
router.delete('/account', requireAuth, deleteAccount);  // ✅ protected account delete

export default router;
