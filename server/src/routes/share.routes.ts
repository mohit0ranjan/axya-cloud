import express from 'express';
import { downloadSharedFile, shareWebPage, validatePassword, downloadAllShared, getUserSharedLinks } from '../controllers/share.controller';
import { requireAuth } from '../middlewares/auth.middleware';

const router = express.Router();

// Authenticated endpoints
router.get('/', requireAuth, getUserSharedLinks);

// Public endpoints — no auth needed
router.get('/:token', shareWebPage);          // Beautiful HTML preview page / folder grid
router.post('/:token/password', validatePassword); // Validate share link password
router.get('/:token/download', downloadSharedFile); // Raw file download
router.get('/:token/download-all', downloadAllShared); // Folder zip download

export default router;
