import express from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import multer from 'multer';
import { sendApiError } from '../utils/apiError';
import {
    fetchFiles, searchFiles, updateFile,
    trashFile, restoreFile, deleteFile, fetchTrash, emptyTrash,
    toggleStar, fetchStarred,

    createFolder, fetchFolders, updateFolder, trashFolder,
    downloadFile, streamFile, streamFileStatus, createPlaybackTicket, getThumbnail, getStats, getActivity,
    bulkAction,
    addTag, removeTag, getFileTags, getFilesByTag, getAllUserTags,
    markAccessed, getRecentlyAccessed,
    getFileDetails, getFileHistory,
} from '../controllers/file.controller';
import { requireAuth } from '../middlewares/auth.middleware';
import { requireMediaTicket } from '../middlewares/media.middleware';

import { syncTelegramFiles } from '../controllers/telegram-sync.controller';
import { getDriveHealth, getDuplicates } from '../controllers/drive-health.controller';
import { advancedSearch, exportManifest, bulkRename, listVersions, changeVersion } from '../controllers/drive-tools.controller';

const router = express.Router();

// HTML video cannot attach Bearer headers. Only this read-only route accepts a scoped ticket.
router.get('/media/:id', requireMediaTicket, streamFile);

// All file routes require auth
router.use(requireAuth);

const withTimeout = (ms: number): express.RequestHandler => {
    return (req, res, next) => {
        const timer = setTimeout(() => {
            if (!res.headersSent) {
                sendApiError(res, 408, 'request_timeout', 'Request took too long to process.', { retryable: true });
                if (!req.destroyed) {
                    req.destroy(new Error('request_timeout'));
                }
            }
        }, ms);
        res.on('finish', () => clearTimeout(timer));
        res.on('close', () => clearTimeout(timer));
        next();
    };
};

// ── Stats & Activity ────────────────────────────────────────────────────────
router.get('/stats', getStats);
const toolsAsync = (fn:any):express.RequestHandler => (req,res,next) => { Promise.resolve(fn(req,res)).catch(next); };
router.get('/discover', toolsAsync(advancedSearch));
router.get('/export-manifest', toolsAsync(exportManifest));
router.post('/bulk-rename', toolsAsync(bulkRename));
router.get('/:id/versions', toolsAsync(listVersions));
router.post('/:id/versions', toolsAsync(changeVersion));
router.get('/health', getDriveHealth);
router.get('/duplicates', getDuplicates);
router.post('/sync', rateLimit({windowMs:60_000,max:6,keyGenerator:(req:any)=>req.user.id}), syncTelegramFiles);
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


import {
    initUpload, uploadChunk, completeUpload, checkUploadStatus, cancelUpload, listUploadSessions, resumeUploadSession, getUploadQueueHealth, pauseUpload, resumePausedUpload
} from '../controllers/upload';

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
import { UPLOAD_TMP_ROOT } from '../controllers/upload/upload.types';
const MULTER_CHUNK_DIR = pathModule.join(UPLOAD_TMP_ROOT, 'multer_chunks');
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
router.post('/upload/chunk', chunkLimiter, withTimeout(10*60*1000), chunkUpload.single('chunk'), uploadChunk);
router.post('/upload/resume', uploadLimiter, resumeUploadSession);
router.post('/upload/pause', uploadLimiter, pauseUpload);
router.post('/upload/resume-paused', uploadLimiter, resumePausedUpload);
router.post('/upload/complete', uploadLimiter, completeUpload);
router.post('/upload/cancel', uploadLimiter, cancelUpload);
router.get('/upload/status/:uploadId', checkUploadStatus);
router.get('/upload/sessions', listUploadSessions);
router.get('/upload/queue-health', getUploadQueueHealth);
router.post('/upload/heartbeat', async (req:any,res) => {
    const id = String(req.body?.uploadId || '');
    if (!/^[a-f0-9-]{36}$/i.test(id)) return sendApiError(res,400,'invalid_request','Invalid upload ID.');
    const db = (await import('../config/db')).default;
    await db.query(`UPDATE upload_sessions SET client_seen_at = NOW() WHERE upload_id = $1 AND user_id = $2 AND status IN ('queued','uploading')`, [id,req.user.id]);
    return res.json({success:true});
});

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
router.post('/:id/playback-ticket', createPlaybackTicket);
router.get('/:id/stream/status', streamFileStatus);
router.get('/:id/stream', streamFile);
router.get('/:id/thumbnail', getThumbnail);
router.patch('/:id', updateFile);
router.delete('/:id', deleteFile);

export default router;
