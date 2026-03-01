import express from 'express';
import { downloadSharedFile, shareWebPage } from '../controllers/share.controller';

const router = express.Router();

// Public endpoints — no auth needed
router.get('/:token', shareWebPage);          // Beautiful HTML preview page
router.get('/:token/download', downloadSharedFile); // Raw file download

export default router;
