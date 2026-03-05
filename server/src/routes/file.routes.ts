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
    // 200 photos = 200 init + 200 complete (+ retries/cancel/status churn).
    // Keep this generous to avoid false 429s on valid batch uploads.
    max: 2000,
    keyGenerator: (req: any) => {
        // Router is already protected by requireAuth, so user id is the safest key.
        return req.user?.id || req.ip || 'unknown';
    },
    message: { success: false, error: 'Upload rate limit reached. Please wait 15 minutes.' },
});

// Separate, more lenient limiter for chunk uploads (many chunks per file)
const chunkLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 6000,  // 200 files × up to ~30 chunks each on large media + retries
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
