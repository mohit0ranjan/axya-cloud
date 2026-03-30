import express from 'express';
import multer from 'multer';
import {
    fetchFiles, searchFiles, updateFile,
    trashFile, restoreFile, deleteFile, fetchTrash, emptyTrash,
    toggleStar, fetchStarred,

    createFolder, fetchFolders, updateFolder, trashFolder,
    downloadFile, streamFile, getThumbnail, getStats, getActivity,
    bulkAction,
    addTag, removeTag, getFileTags, getFilesByTag, getAllUserTags,
    markAccessed, getRecentlyAccessed,
    getFileDetails, getFileHistory,
} from '../controllers/file.controller';
import { requireAuth } from '../middlewares/auth.middleware';

const router = express.Router();

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

import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import {
    initUpload, uploadChunk, uploadStream, completeUpload, checkUploadStatus, cancelUpload, listUploadSessions, resumeUploadSession
} from '../controllers/upload.controller';

const uploadLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    // 200 photos = 200 init + 200 complete (+ retries/cancel/status churn).
    // Keep this generous to avoid false 429s on valid batch uploads.
    max: 2000,
    keyGenerator: (req: any) => {
        // Router is already protected by requireAuth, so user id is the safest key.
        const rawIp =
            (typeof req.ip === 'string' && req.ip) ||
            (typeof req.socket?.remoteAddress === 'string' && req.socket.remoteAddress) ||
            '';
        return req.user?.id || ipKeyGenerator(rawIp) || 'unknown';
    },
    message: { success: false, error: 'Upload rate limit reached. Please wait 15 minutes.' },
});

// Separate, more lenient limiter for chunk uploads (many chunks per file)
const chunkLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 6000,  // 200 files × up to ~30 chunks each on large media + retries
    message: { success: false, error: 'Chunk upload rate limit reached.' },
});

// Fix #3: Use the same UPLOAD_TMP_ROOT as the maintenance cleanup loop
// instead of a standalone 'uploads/' dir that's never cleaned by maintenance.
import os from 'os';
import pathModule from 'path';
const MULTER_CHUNK_DIR = pathModule.join(os.tmpdir(), 'axya_uploads', 'multer_chunks');
try { require('fs').mkdirSync(MULTER_CHUNK_DIR, { recursive: true }); } catch { /* best effort */ }

const chunkUpload = multer({
    dest: MULTER_CHUNK_DIR,
    limits: {
        // Fixed 5MB chunk protocol (+ multipart overhead buffer).
        fileSize: 6 * 1024 * 1024,
    },
});

// ── File Upload & List ───────────────────────────────────────────────────────
router.post('/upload/init', uploadLimiter, initUpload);
router.post('/upload/stream/:uploadId', uploadLimiter, uploadStream);
router.post('/upload/chunk', chunkLimiter, chunkUpload.single('chunk'), uploadChunk);
router.post('/upload/resume', uploadLimiter, resumeUploadSession);
router.post('/upload/complete', uploadLimiter, completeUpload);
router.post('/upload/cancel', uploadLimiter, cancelUpload);
router.get('/upload/status/:uploadId', checkUploadStatus);
router.get('/upload/sessions', listUploadSessions);

router.post('/upload', (_req, res) => {
    res.set('Deprecation', 'true');
    res.set('Sunset', '2026-06-01');
    return res.status(410).json({
        success: false,
        code: 'legacy_upload_removed',
        error: 'Legacy full upload endpoint is removed. Use chunk upload flow: /upload/init -> /upload/chunk -> /upload/complete.',
        retryable: false,
    });
});
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
router.get('/:id/history', getFileHistory);

// ── Recently Accessed Mark ───────────────────────────────────────────────────
router.post('/:id/accessed', markAccessed);

// ── File CRUD ────────────────────────────────────────────────────────────────
router.get('/:id/download', downloadFile);
router.get('/:id/stream', streamFile);
router.get('/:id/thumbnail', getThumbnail);
router.patch('/:id', updateFile);
router.delete('/:id', deleteFile);

export default router;
