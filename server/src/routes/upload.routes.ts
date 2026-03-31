import express from 'express';
import multer from 'multer';
import os from 'os';
import path from 'path';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { requireAuth } from '../middlewares/auth.middleware';
import { validateRequest } from '../middlewares/validateRequest';
import { sendApiError } from '../utils/apiError';
import {
    initUpload,
    uploadChunk,
    completeUpload,
    pauseUpload,
    resumePausedUpload,
    checkUploadStatus,
    getUploadQueueHealth,
    listUploadSessions,
    cancelUpload,
    resumeUploadSession,
    uploadFile,
    getUploadFileStatus,
    cancelUploadFile,
} from '../controllers/upload';

const router = express.Router();
router.use(requireAuth);

const asyncRoute = (handler: any): express.RequestHandler => {
    return (req, res, next) => {
        Promise.resolve(handler(req, res, next)).catch(next);
    };
};

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

const emptyObjectSchema = z.object({}).passthrough();
const withBody = <T extends z.ZodTypeAny>(body: T) => z.object({
    body,
    query: emptyObjectSchema,
    params: emptyObjectSchema,
});
const withParams = <T extends z.ZodTypeAny>(params: T) => z.object({
    body: emptyObjectSchema,
    query: emptyObjectSchema,
    params,
});
const withQuery = <T extends z.ZodTypeAny>(query: T) => z.object({
    body: emptyObjectSchema,
    query,
    params: emptyObjectSchema,
});

const uploadIdSchema = z.string().trim().min(1).max(128);

const initUploadSchema = withBody(z.object({
    originalname: z.string().trim().min(1).max(512),
    size: z.coerce.number().int().positive(),
    mimetype: z.string().trim().min(1).max(256),
    folder_id: z.coerce.number().int().positive().optional().nullable(),
    telegram_chat_id: z.string().trim().min(1).max(128).optional().nullable(),
    hash: z.string().trim().min(1).max(128).optional(),
    partial_hash: z.string().trim().min(1).max(128).optional(),
    source_tag: z.string().trim().max(64).optional(),
    chunk_size_bytes: z.coerce.number().int().positive().optional(),
}));

const uploadChunkSchema = withBody(z.object({
    uploadId: uploadIdSchema,
    chunkIndex: z.coerce.number().int().min(0),
    chunkHash: z.string().trim().regex(/^[a-f0-9]{64}$/i).optional(),
    chunkBase64: z.string().trim().min(1).max(10 * 1024 * 1024).optional(),
}));

const uploadIdBodySchema = withBody(z.object({
    uploadId: uploadIdSchema,
}));

const resumeTokenSchema = withBody(z.object({
    uploadId: uploadIdSchema.optional(),
    resumeToken: z.string().trim().min(1).max(1024).optional(),
}));

const uploadIdParamsSchema = withParams(z.object({
    uploadId: uploadIdSchema,
}));

const uploadStatusQuerySchema = withQuery(z.object({
    uploadId: uploadIdSchema,
}));

const uploadLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 2200,
    handler: (_req, res) => sendApiError(
        res,
        429,
        'rate_limited',
        'Upload rate limit reached. Please wait 15 minutes.',
        { retryable: true, retryAfterSeconds: 15 * 60 }
    ),
});

const chunkLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 7000,
    handler: (_req, res) => sendApiError(
        res,
        429,
        'rate_limited',
        'Chunk upload rate limit reached.',
        { retryable: true, retryAfterSeconds: 15 * 60 }
    ),
});

const chunkDir = path.join(os.tmpdir(), 'axya_uploads', 'multer_chunks');
try { require('fs').mkdirSync(chunkDir, { recursive: true }); } catch { }

const chunkUpload = multer({
    dest: chunkDir,
    limits: {
        fileSize: 6 * 1024 * 1024,
    },
});

// Production single-file upload configuration
const fileUploadDir = path.join(os.tmpdir(), 'teledrive_uploads');
try { require('fs').mkdirSync(fileUploadDir, { recursive: true }); } catch { }

const fileUpload = multer({
    dest: fileUploadDir,
    limits: {
        fileSize: 5 * 1024 * 1024 * 1024, // 5GB
    },
});

router.post('/init', uploadLimiter, withTimeout(15000), validateRequest(initUploadSchema), asyncRoute(initUpload));
router.post('/chunk', chunkLimiter, withTimeout(60000), chunkUpload.single('chunk'), validateRequest(uploadChunkSchema), asyncRoute(uploadChunk));
router.post('/complete', uploadLimiter, withTimeout(30000), validateRequest(uploadIdBodySchema), asyncRoute(completeUpload));
router.post('/pause', uploadLimiter, withTimeout(15000), validateRequest(uploadIdBodySchema), asyncRoute(pauseUpload));
router.post('/resume', uploadLimiter, withTimeout(15000), validateRequest(uploadIdBodySchema), asyncRoute(resumePausedUpload));
router.post('/cancel', uploadLimiter, withTimeout(15000), validateRequest(uploadIdBodySchema), asyncRoute(cancelUpload));

router.get('/status/:uploadId', withTimeout(10000), validateRequest(uploadIdParamsSchema), asyncRoute(checkUploadStatus));
router.get('/status', withTimeout(10000), validateRequest(uploadStatusQuerySchema), asyncRoute((req: any, res: any) => {
    const uploadId = String(req.query.uploadId || '').trim();
    (req as any).params = { ...(req as any).params, uploadId };
    return checkUploadStatus(req as any, res as any);
}));

router.get('/sessions', withTimeout(15000), asyncRoute(listUploadSessions));
router.get('/queue-health', withTimeout(10000), asyncRoute(getUploadQueueHealth));

// Optional token-based resume flow for clients that support resume tokens.
router.post('/resume-token', uploadLimiter, withTimeout(15000), validateRequest(resumeTokenSchema), asyncRoute(resumeUploadSession));

// ============================================================================
// PRODUCTION SIMPLE UPLOAD ENDPOINTS
// ============================================================================

const simpleUploadSchema = z.object({
    body: z.object({
        folderId: z.coerce.number().int().positive().optional(),
        telegramChatId: z.string().trim().optional(),
    }).passthrough(),
    query: emptyObjectSchema,
    params: emptyObjectSchema,
});

const simpleCancelSchema = withParams(z.object({
    uploadId: uploadIdSchema,
}));

// POST /upload/file - Upload a single file
router.post(
    '/file',
    uploadLimiter,
    withTimeout(300000), // 5 minutes for large files
    fileUpload.single('file'),
    validateRequest(simpleUploadSchema),
    asyncRoute(uploadFile)
);

// GET /upload/file/status/:uploadId - Get file upload status
router.get(
    '/file/status/:uploadId',
    withTimeout(10000),
    validateRequest(simpleCancelSchema),
    asyncRoute(getUploadFileStatus)
);

// POST /upload/file/cancel/:uploadId - Cancel file upload
router.post(
    '/file/cancel/:uploadId',
    uploadLimiter,
    withTimeout(15000),
    validateRequest(simpleCancelSchema),
    asyncRoute(cancelUploadFile)
);

export default router;
