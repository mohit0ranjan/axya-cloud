import express from 'express';
import { createShareLink, downloadSharedFile, shareWebPage, validatePassword, downloadAllShared, getUserSharedLinks, revokeShareLink, sharePasswordGateScript } from '../controllers/share.controller';
import { requireAuth } from '../middlewares/auth.middleware';
import { sharePasswordLimiter, shareViewLimiter, shareDownloadLimiter } from '../middlewares/rateLimit.middleware';

const router = express.Router();

// Authenticated endpoints
router.get('/', requireAuth, getUserSharedLinks);
router.post('/', requireAuth, createShareLink);
router.delete('/:id', requireAuth, revokeShareLink);
router.get('/client/password-gate.js', sharePasswordGateScript); // CSP-safe script for password page

// Public endpoints — no auth needed
router.get('/:token', shareViewLimiter, shareWebPage);          // Beautiful HTML preview page / folder grid
router.post('/:token/password', sharePasswordLimiter, validatePassword); // Validate share link password
router.get('/:token/download', shareDownloadLimiter, downloadSharedFile); // Raw file download
router.get('/:token/content', shareDownloadLimiter, downloadSharedFile); // Raw file content for inline previews
router.get('/:token/download-all', shareDownloadLimiter, downloadAllShared); // Folder zip download

export default router;
