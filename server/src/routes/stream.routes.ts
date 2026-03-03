/**
 * stream.routes.ts — Video/file streaming routes
 *
 * GET /stream/:fileId        — Progressive streaming with HTTP Range support
 * GET /stream/:fileId/status — Download/cache status for streaming badge
 *
 * Protected by JWT auth middleware.
 */

import express from 'express';
import { streamMedia, streamStatus } from '../controllers/stream.controller';
import { requireAuth } from '../middlewares/auth.middleware';

const router = express.Router();

// All stream routes require auth
router.use(requireAuth);

// Stream status (for "Streaming…" / "Downloaded" badge)
router.get('/:fileId/status', streamStatus);

// Progressive stream with Range support
router.get('/:fileId', streamMedia);

export default router;
