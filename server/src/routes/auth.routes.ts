import express from 'express';
import { sendCode, verifyCode, getMe } from '../controllers/auth.controller';
import { requireAuth } from '../middlewares/auth.middleware';

const router = express.Router();

router.post('/send-code', sendCode);
router.post('/verify-code', verifyCode);
router.get('/me', requireAuth, getMe);

export default router;
