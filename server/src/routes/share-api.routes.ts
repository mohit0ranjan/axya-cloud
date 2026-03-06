import express from 'express';
import { getSharePublicFiles, getSharePublicMeta, verifyShareAccess } from '../controllers/share.controller';
import { sharePasswordLimiter, shareViewLimiter } from '../middlewares/rateLimit.middleware';

const router = express.Router();

router.post('/verify', sharePasswordLimiter, verifyShareAccess);
router.get('/:shareId/files', shareViewLimiter, getSharePublicFiles);
router.get('/:shareId', shareViewLimiter, getSharePublicMeta);

export default router;
