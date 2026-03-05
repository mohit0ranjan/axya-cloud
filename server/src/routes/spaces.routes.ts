import express from 'express';
import multer from 'multer';
import {
    createSpace,
    getSpacePublic,
    listOwnerSpaces,
    listSpaceFiles,
    uploadToSpace,
    validateSpacePassword,
} from '../controllers/spaces.controller';
import { requireAuth } from '../middlewares/auth.middleware';
import {
    spacePasswordLimiter,
    spaceUploadLimiter,
    spaceViewLimiter,
} from '../middlewares/rateLimit.middleware';

const router = express.Router();
const upload = multer({
    dest: 'uploads/shared-spaces',
    limits: {
        fileSize: Number.parseInt(process.env.SHARED_SPACE_MAX_UPLOAD_BYTES || '', 10) || 200 * 1024 * 1024,
    },
});

router.get('/', requireAuth, listOwnerSpaces);
router.post('/create', requireAuth, createSpace);

router.get('/:id', spaceViewLimiter, getSpacePublic);
router.post('/:id/validate-password', spacePasswordLimiter, validateSpacePassword);
router.get('/:id/files', spaceViewLimiter, listSpaceFiles);
router.post('/:id/upload', spaceUploadLimiter, upload.single('file'), uploadToSpace);

export default router;
