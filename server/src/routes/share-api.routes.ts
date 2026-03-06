import express from 'express';
import {
    createShareLink,
    downloadSharedFile,
    getShareFiles,
    getShareSession,
    verifySharePassword,
} from '../controllers/share.controller';
import { requireAuth } from '../middlewares/auth.middleware';
import { shareDownloadLimiter, sharePasswordLimiter, shareViewLimiter } from '../middlewares/rateLimit.middleware';

const router = express.Router();

router.post('/create', requireAuth, createShareLink);
router.post('/verify-password', sharePasswordLimiter, verifySharePassword);
router.get('/files', shareViewLimiter, getShareFiles);
router.get('/download/:fileId', shareDownloadLimiter, downloadSharedFile);
router.get('/:shareId', shareViewLimiter, getShareSession);

export default router;
