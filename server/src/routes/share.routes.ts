import express from 'express';
import { createShareLink, listUserShares, revokeShareLink } from '../controllers/share.controller';
import { requireAuth } from '../middlewares/auth.middleware';

const router = express.Router();

router.get('/', requireAuth, listUserShares);
router.post('/', requireAuth, createShareLink);
router.delete('/:id', requireAuth, revokeShareLink);

export default router;
