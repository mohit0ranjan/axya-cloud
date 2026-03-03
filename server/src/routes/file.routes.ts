import express from 'express';
import multer from 'multer';
import {
    uploadFile, fetchFiles, searchFiles, updateFile,
    trashFile, restoreFile, deleteFile, fetchTrash, emptyTrash,
    toggleStar, fetchStarred,

    createFolder, fetchFolders, updateFolder, trashFolder,
    downloadFile, streamFile, getThumbnail, getStats, getActivity,
    bulkAction,
    addTag, removeTag, getFileTags, getFilesByTag, getAllUserTags,
    markAccessed, getRecentlyAccessed,
    getFileDetails,
} from '../controllers/file.controller';
import { createShareLink, revokeShareLink } from '../controllers/share.controller';
import { requireAuth } from '../middlewares/auth.middleware';

const router = express.Router();

const upload = multer({
    dest: 'uploads/',
    limits: { fileSize: 2 * 1024 * 1024 * 1024 }, // 2GB limit
});

// All file routes require auth
router.use(requireAuth);

// ── Stats & Activity ────────────────────────────────────────────────────────
router.get('/stats', getStats);
router.get('/activity', getActivity);

// ── Search ───────────────────────────────────────────────────────────────────
router.get('/search', searchFiles);

// ── Tags ─────────────────────────────────────────────────────────────────────
router.get('/tags', getAllUserTags);
router.get('/tags/:tag', getFilesByTag);

// ── Starred ──────────────────────────────────────────────────────────────────
router.get('/starred', fetchStarred);
router.patch('/:id/star', toggleStar);

// ── Trash ────────────────────────────────────────────────────────────────────
router.get('/trash', fetchTrash);
router.patch('/:id/trash', trashFile);
router.patch('/:id/restore', restoreFile);
router.delete('/trash', emptyTrash);


// ── Folders ──────────────────────────────────────────────────────────────────
router.post('/folder', createFolder);
router.get('/folders', fetchFolders);
router.patch('/folder/:id', updateFolder);
router.delete('/folder/:id', trashFolder);

import rateLimit from 'express-rate-limit';
import {
    initUpload, uploadChunk, completeUpload, checkUploadStatus, cancelUpload
} from '../controllers/upload.controller';

const uploadLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    // ✅ 100 photos = 100 init + ~200 chunks + 100 complete = 400+ requests
    // Raised from 100 to 500 to accommodate batch uploads
    max: 500,
    keyGenerator: (req) => {
        // Rate limit per user (JWT sub) not per IP — fairer for mobile users
        const auth = req.headers.authorization || '';
        if (auth.startsWith('Bearer ')) {
            const token = auth.slice(7);
            try {
                const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
                return payload.id || req.ip || 'unknown';
            } catch { }
        }
        return req.ip || 'unknown';
    },
    message: { success: false, error: 'Upload rate limit reached. Please wait 15 minutes.' },
});

// Separate, more lenient limiter for chunk uploads (many chunks per file)
const chunkLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 2000,  // 100 files × 20 chunks each = 2000 chunk requests
    message: { success: false, error: 'Chunk upload rate limit reached.' },
});

// ── File Upload & List ───────────────────────────────────────────────────────
router.post('/upload/init', uploadLimiter, initUpload);
router.post('/upload/chunk', chunkLimiter, upload.single('chunk'), uploadChunk);
router.post('/upload/complete', uploadLimiter, completeUpload);
router.post('/upload/cancel', uploadLimiter, cancelUpload);
router.get('/upload/status/:uploadId', checkUploadStatus);

router.post('/upload', upload.single('file'), uploadFile); // Legacy fallback
router.get('/', fetchFiles);

// ── Bulk Actions ─────────────────────────────────────────────────────────────
router.post('/bulk', bulkAction);

// ── Recently Accessed ─────────────────────────────────────────────────────────
router.get('/recent-accessed', getRecentlyAccessed);

// ── Share Links ───────────────────────────────────────────────────────────────
router.post('/:id/share', createShareLink);
router.delete('/:id/share', revokeShareLink);

// ── File Tags ────────────────────────────────────────────────────────────────
router.get('/:id/tags', getFileTags);
router.post('/:id/tags', addTag);
router.delete('/:id/tags/:tag', removeTag);

// ── File Details ─────────────────────────────────────────────────────────────
router.get('/:id/details', getFileDetails);

// ── Recently Accessed Mark ───────────────────────────────────────────────────
router.post('/:id/accessed', markAccessed);

// ── File CRUD ────────────────────────────────────────────────────────────────
router.get('/:id/download', downloadFile);
router.get('/:id/stream', streamFile);
router.get('/:id/thumbnail', getThumbnail);
router.patch('/:id', updateFile);
router.delete('/:id', deleteFile);

export default router;
