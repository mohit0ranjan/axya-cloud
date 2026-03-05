import express from 'express';
import { downloadSharedSpaceFile } from '../controllers/spaces.controller';
import { signedDownloadLimiter } from '../middlewares/rateLimit.middleware';

const router = express.Router();

router.get('/:id/download', signedDownloadLimiter, downloadSharedSpaceFile);

export default router;
