import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import helmet from 'helmet';
import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import { initSchema } from './services/db.service';
import pool from './config/db';
import authRoutes from './routes/auth.routes';
import fileRoutes from './routes/file.routes';
import shareV2Routes from './routes/share-v2.routes';
import streamRoutes from './routes/stream.routes';
import { logger } from './utils/logger';
import { getDynamicClient } from './services/telegram.service';
import { sendApiError } from './utils/apiError';
import { FRONTEND_BASE_URL, SERVER_BASE_URL } from './config/urls';

dotenv.config();

const app = express();
const port = Number(process.env.PORT) || 3000;
const isProduction = process.env.NODE_ENV === 'production';
const REQUIRED_NODE_MAJOR = 20;
const SCHEMA_RETRY_DELAY_MS = 5000;
const SCHEMA_MAX_RETRIES = 12;
const SCHEMA_RETRY_AFTER_SECONDS = Math.max(1, Math.ceil(SCHEMA_RETRY_DELAY_MS / 1000));
const HEALTH_DB_TIMEOUT_MS = Number.parseInt(String(process.env.HEALTH_DB_TIMEOUT_MS || '1200'), 10) || 1200;
const isHealthPath = (p: string) => p === '/health' || p === '/health/';
const redactSensitiveQuery = (url: string) =>
    url
        .replace(/([?&](?:token|session_token|sessionToken|password|otp|code|k|secret)=)[^&]*/gi, '$1[redacted]')
        .replace(/([?&](?:authorization)=)[^&]*/gi, '$1[redacted]');
const getRequestId = (req: Request, res?: Response): string => {
    const responseHeader = res ? String(res.getHeader('x-request-id') || '').trim() : '';
    const requestHeader = String(req.headers['x-request-id'] || '').trim();
    const requestScoped = String((req as any).requestId || '').trim();
    return requestScoped || responseHeader || requestHeader;
};

let schemaReady = false;
let schemaInitAttempts = 0;
let schemaLastError = '';
let schemaState: 'starting' | 'ready' | 'degraded' = 'starting';
let telegramWarmupStatus: 'idle' | 'ready' | 'partial' | 'failed' | 'skipped' = 'idle';

app.disable('x-powered-by');

app.use((req, res, next) => {
    const incomingRequestId = String(req.headers['x-request-id'] || '').trim();
    const requestId = incomingRequestId || crypto.randomUUID();
    (req as any).requestId = requestId;
    res.setHeader('x-request-id', requestId);
    next();
});

app.use(morgan(':req[x-request-id] :method :url :status :response-time ms', {
    skip: (req) => isHealthPath(req.path),
    stream: {
        write: (line: string) => {
            logger.info('backend.http', 'request.access', { line: line.trim() });
        },
    },
}));

// Logging all incoming requests (less verbose in production)
app.use((req, res, next) => {
    const startedAt = Date.now();
    res.on('finish', () => {
        const requestId = getRequestId(req, res);
        logger.info('backend.http', 'request.complete', {
            method: req.method,
            url: redactSensitiveQuery(req.originalUrl || req.url || ''),
            status: res.statusCode,
            durationMs: Date.now() - startedAt,
            ip: req.ip,
            requestId: requestId || null,
        });
    });
    next();
});

// Enable trust proxy for cloud platforms (Railway, Render, etc.)
app.set('trust proxy', 1);

// ── Security Middleware ─────────────────────────────────────────────────────
app.use((req, res, next) => {
    res.locals.nonce = crypto.randomBytes(16).toString('base64');
    next();
});

app.use(helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    contentSecurityPolicy: {
        directives: {
            ...helmet.contentSecurityPolicy.getDefaultDirectives(),
            "script-src": ["'self'", (req, res) => "'nonce-" + (res as any).locals.nonce + "'"],
            "script-src-attr": ["'none'"],
            "style-src": ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        },
    },
}));

const defaultAllowedOrigins = isProduction ? [
    'https://axya-web.onrender.com'
] : [
    'http://localhost:3000',
    'http://localhost:3001',
    'http://localhost:8081',
];
const configuredAllowedOrigins = String(process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

let frontendOrigin = '';
try {
    if (FRONTEND_BASE_URL) frontendOrigin = new URL(FRONTEND_BASE_URL).origin;
} catch {
    logger.warn('backend.http', 'cors.invalid_frontend_base_url', { value: FRONTEND_BASE_URL });
}

let serverOrigin = '';
try {
    if (SERVER_BASE_URL) serverOrigin = new URL(SERVER_BASE_URL).origin;
} catch {
    logger.warn('backend.http', 'cors.invalid_server_base_url', { value: SERVER_BASE_URL });
}

const allowedOrigins = Array.from(
    new Set([...defaultAllowedOrigins, ...configuredAllowedOrigins, frontendOrigin, serverOrigin].filter(Boolean))
);
const allowedMethods = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'];
const defaultAllowedHeaders = ['Authorization', 'Content-Type', 'X-Requested-With'];
const isAllowedOrigin = (origin?: string) => {
    if (!origin) return true;
    if (!isProduction && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin)) {
        return true;
    }
    return allowedOrigins.includes(origin);
};
const corsOptions: cors.CorsOptions = {
    origin: (origin, callback) => {
        if (isAllowedOrigin(origin)) {
            callback(null, true);
            return;
        }
        callback(new Error('Origin not allowed by CORS'));
    },
    credentials: true,
    methods: allowedMethods,
    allowedHeaders: defaultAllowedHeaders,
    optionsSuccessStatus: 204,
};
app.use((req, res, next) => {
    const requestOrigin = typeof req.headers.origin === 'string' ? req.headers.origin : '';
    if (requestOrigin && isAllowedOrigin(requestOrigin)) {
        res.header('Access-Control-Allow-Origin', requestOrigin);
        res.header('Vary', 'Origin');
        res.header('Access-Control-Allow-Credentials', 'true');
        res.header('Access-Control-Allow-Methods', allowedMethods.join(', '));

        const requestedHeaders = req.headers['access-control-request-headers'];
        res.header(
            'Access-Control-Allow-Headers',
            typeof requestedHeaders === 'string' && requestedHeaders.trim()
                ? requestedHeaders
                : defaultAllowedHeaders.join(', ')
        );
    } else if (requestOrigin) {
        return sendApiError(res, 403, 'forbidden', 'Origin not allowed by CORS.', { retryable: false });
    }

    if (req.method === 'OPTIONS') {
        return res.sendStatus(204);
    }

    return next();
});
app.use(cors(corsOptions));
app.options(/.*/, cors(corsOptions));

// ── Body Parsing ────────────────────────────────────────────────────────────
// ⚠️ Reduced from 50mb to 10mb — chunks are sent individually, not whole file
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
const cookieSecret = process.env.COOKIE_SECRET || process.env.JWT_SECRET || crypto.randomUUID();
if (isProduction && !process.env.COOKIE_SECRET) {
    throw new Error('COOKIE_SECRET is required in production.');
}
app.use(cookieParser(cookieSecret));

// Keep process alive during transient DB outages; return 503 until schema/init is ready.
app.use((req, res, next) => {
    if (schemaReady) return next();
    if (req.path === '/' || isHealthPath(req.path)) return next();
    const requestId = getRequestId(req, res);
    logger.warn('backend.http', 'schema_not_ready_reject', {
        method: req.method,
        url: redactSensitiveQuery(req.originalUrl || req.url || ''),
        schemaState,
        retryAfterSeconds: SCHEMA_RETRY_AFTER_SECONDS,
        ip: req.ip,
        requestId: requestId || null,
    });
    return sendApiError(
        res,
        503,
        'schema_not_ready',
        schemaState === 'degraded'
            ? 'Server is temporarily degraded. Please retry shortly.'
            : 'Server is starting up. Please retry in a few seconds.',
        {
            retryable: true,
            retryAfterSeconds: SCHEMA_RETRY_AFTER_SECONDS,
            details: { schemaState, requestId: requestId || null },
        }
    );
});

// ── Global Rate Limiting ───────────────────────────────────────────────────
// ✅ Raised from 200 to 1000 — 100 photos × (init + chunks + complete) = 400+ requests
const globalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 2500,                 // ✅ was 200, then 1000 — raised for 500+ item share grids
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => {
        // Always skip rate limiting for lightweight health checks.
        return isHealthPath(req.path);
    },
    handler: (_req, res) => {
        return sendApiError(
            res,
            429,
            'rate_limited',
            'Too many requests. Please try again in 15 minutes.',
            { retryable: true, retryAfterSeconds: 15 * 60 }
        );
    },
});
app.use(globalLimiter);

// Strict limiter for auth endpoints — prevent OTP brute force
const authLimiter = rateLimit({
    windowMs: 10 * 60 * 1000,
    max: 15,  // ✅ was 10, slightly raised to allow 5 phone numbers + retries
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
        logger.warn('backend.auth', 'rate_limit_hit', {
            path: req.path,
            method: req.method,
            ip: req.ip,
            origin: req.headers.origin,
            userAgent: req.headers['user-agent'],
        });
        return sendApiError(
            res,
            429,
            'rate_limited',
            'Too many auth attempts, please wait 10 minutes.',
            { retryable: false, retryAfterSeconds: 10 * 60 }
        );
    },
});

// ── Routes ──────────────────────────────────────────────────────────────────
app.use('/auth', authLimiter, authRoutes);
app.use('/files', fileRoutes);
app.use('/api/v2', shareV2Routes);
app.use('/stream', streamRoutes);

// ── Lightweight Health Check (Render keep-alive friendly) ───────────────────
// Keep this endpoint fast and dependency-free for external keep-alive pings.
app.get('/health', async (req: Request, res: Response) => {
    const startedAt = Date.now();
    const requestTimestamp = new Date().toISOString();
    const requestId = getRequestId(req, res);
    const deepCheckRequested = String(req.query.deep || '').trim() === '1';

    const runDbHealthCheck = async (): Promise<'ok' | 'degraded'> => {
        try {
            await Promise.race([
                pool.query('SELECT 1'),
                new Promise((_, reject) => setTimeout(() => reject(new Error('health_db_timeout')), HEALTH_DB_TIMEOUT_MS)),
            ]);
            return 'ok';
        } catch {
            return 'degraded';
        }
    };

    // Emit an explicit keep-alive log for cron monitoring and debugging.
    res.on('finish', () => {
        logger.info('backend.health', 'ping', {
            requestTimestamp,
            responseStatus: res.statusCode,
            durationMs: Date.now() - startedAt,
            ip: req.ip,
            userAgent: req.headers['user-agent'] || null,
            requestId: requestId || null,
            deepCheckRequested,
        });
    });

    try {
        const dbState = deepCheckRequested ? await runDbHealthCheck() : 'skipped';
        const status = schemaReady && dbState !== 'degraded'
            ? 'ok'
            : schemaState === 'starting'
                ? 'starting'
                : 'degraded';
        const readyForUploads = schemaReady && (deepCheckRequested ? dbState === 'ok' : true);

        return res.status(200).json({
            status,
            readyForUploads,
            uptime: Math.floor(process.uptime()),
            timestamp: requestTimestamp,
            request_id: requestId || null,
            checks: {
                schema: schemaState,
                db: dbState,
                telegramWarmup: telegramWarmupStatus,
            },
        });
    } catch (err: any) {
        logger.error('backend.health', 'health_response_error', {
            message: String(err?.message || err || 'unknown'),
            requestId: requestId || null,
        });

        // Fail gracefully for cron callers without heavy dependencies.
        return res.status(200).json({
            status: 'degraded',
            readyForUploads: false,
            uptime: Math.floor(process.uptime() || 0),
            timestamp: requestTimestamp,
            request_id: requestId || null,
            checks: {
                schema: schemaState,
                db: 'degraded',
                telegramWarmup: telegramWarmupStatus,
            },
        });
    }
});

// ── Root route (prevents 404 on cold-start probe) ───────────────────────────
app.get('/', (req: Request, res: Response) => {
    res.json({ status: 'OK', service: 'Axya Cloud API', version: '1.0.0' });
});

// ── Global Error Handler ────────────────────────────────────────────────────
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
    const requestId = getRequestId(req, res);
    logger.error('backend.http', 'unhandled_error', {
        method: req.method,
        url: redactSensitiveQuery(req.originalUrl || req.url || ''),
        message: err.message,
        stack: err.stack,
        requestId: requestId || null,
    });
    if (res.headersSent) return next(err);

    // Handle multer errors
    if ((err as any).code === 'LIMIT_FILE_SIZE') {
        return sendApiError(res, 413, 'invalid_request', 'File too large', {
            retryable: false,
            details: { requestId: requestId || null },
        });
    }

    return sendApiError(res, 500, 'internal_error', 'Internal Server Error', {
        retryable: true,
        details: { requestId: requestId || null },
    });
});

// ── Graceful Shutdown ────────────────────────────────────────────────────────
const shutdown = async (signal: string) => {
    logger.info('backend.process', 'shutdown_signal', { signal });
    try {
        await pool.end();
        logger.info('backend.process', 'db_pool_closed');
    } catch (e) { }
    process.exit(0);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// ── Uncaught exception handler (prevent Render dyno crash) ──────────────────
process.on('uncaughtException', (err) => {
    logger.error('backend.process', 'uncaught_exception', { message: err.message, stack: err.stack });
    // Don't exit — let Render restart if needed via health check
});

process.on('unhandledRejection', (reason) => {
    logger.error('backend.process', 'unhandled_rejection', { reason });
});

// ── Startup ──────────────────────────────────────────────────────────────────

/**
 * Ensure upload temp root exists without wiping active partial files.
 * Upload sessions are now persisted in DB and rely on these files for restart resume.
 */
function cleanOrphanedUploads(): void {
    const tmpDir = path.join(os.tmpdir(), 'axya_uploads');
    try {
        fs.mkdirSync(tmpDir, { recursive: true });
        logger.info('backend.startup', 'upload_tmp_ready', { tmpDir });
    } catch (e: any) {
        // Non-fatal — log and continue
        logger.warn('backend.startup', 'orphaned_uploads_cleanup_failed', {
            tmpDir,
            message: e?.message,
        });
    }
}

const enforceSupportedNodeRuntime = () => {
    const major = Number.parseInt(process.versions.node.split('.')[0] || '0', 10);
    if (major === REQUIRED_NODE_MAJOR) return;

    const message = `Node ${REQUIRED_NODE_MAJOR}.x is required, but current runtime is ${process.version}.`;
    if (isProduction) {
        throw new Error(message);
    }
    logger.warn('backend.startup', 'node_runtime_mismatch', { required: `${REQUIRED_NODE_MAJOR}.x`, current: process.version });
};

const getStorageSessionCandidates = (): string[] => {
    const candidates = [
        String(process.env.TELEGRAM_STORAGE_SESSION || '').trim(),
        String(process.env.TELEGRAM_SESSION || '').trim(),
    ].filter(Boolean);
    return Array.from(new Set(candidates));
};

const warmStorageTelegramSessions = async () => {
    const sessions = getStorageSessionCandidates();
    if (!sessions.length) {
        telegramWarmupStatus = 'skipped';
        logger.warn('backend.startup', 'telegram_storage_session_missing', {
            message: 'No TELEGRAM_STORAGE_SESSION/TELEGRAM_SESSION configured; shared previews may depend on owner session.',
        });
        return;
    }

    const outcomes = await Promise.all(
        sessions.map(async (session, idx) => {
            try {
                await getDynamicClient(session);
                logger.info('backend.startup', 'telegram_storage_session_ready', {
                    slot: idx,
                });
                return true;
            } catch (err: any) {
                logger.warn('backend.startup', 'telegram_storage_session_failed', {
                    slot: idx,
                    message: err?.message || 'unknown',
                });
                return false;
            }
        })
    );
    const successCount = outcomes.filter(Boolean).length;
    if (successCount === 0) telegramWarmupStatus = 'failed';
    else if (successCount < sessions.length) telegramWarmupStatus = 'partial';
    else telegramWarmupStatus = 'ready';
};

const scheduleSchemaInitRetry = (delayMs: number) => {
    setTimeout(() => {
        void initializeCoreServices();
    }, delayMs);
};

const initializeCoreServices = async () => {
    schemaInitAttempts += 1;
    try {
        await initSchema();
        schemaReady = true;
        schemaState = 'ready';
        schemaLastError = '';
        logger.info('backend.startup', 'schema_ready', { attempts: schemaInitAttempts });
    } catch (error: any) {
        schemaReady = false;
        schemaState = 'starting';
        schemaLastError = String(error?.message || error || 'unknown');
        logger.error('backend.startup', 'schema_init_failed', {
            attempt: schemaInitAttempts,
            message: schemaLastError,
        });
        if (schemaInitAttempts >= 3) {
            logger.error('backend.startup', 'schema_init_alert', {
                attempt: schemaInitAttempts,
                message: schemaLastError,
            });
        }

        const shouldRetry = SCHEMA_MAX_RETRIES <= 0 || schemaInitAttempts < SCHEMA_MAX_RETRIES;
        if (shouldRetry) {
            scheduleSchemaInitRetry(SCHEMA_RETRY_DELAY_MS);
        } else {
            schemaState = 'degraded';
            logger.error('backend.startup', 'schema_init_degraded', {
                attempts: schemaInitAttempts,
                message: schemaLastError,
            });
        }
        return;
    }

    try {
        await warmStorageTelegramSessions();
    } catch (error: any) {
        // Telegram session warmup should never crash the API process.
        logger.warn('backend.startup', 'telegram_warmup_failed', {
            message: String(error?.message || error || 'unknown'),
        });
    }
};

const start = async () => {
    try {
        logger.info('backend.startup', 'server_starting', { port });
        enforceSupportedNodeRuntime();
        cleanOrphanedUploads();
        app.listen(port, '0.0.0.0', () => {
            logger.info('backend.startup', 'server_ready', {
                bind: `http://0.0.0.0:${port}`,
                node: process.version,
                env: process.env.NODE_ENV || 'development',
            });
        });
        void initializeCoreServices();
    } catch (error: any) {
        logger.error('backend.startup', 'server_bind_failed', {
            message: error?.message,
            stack: error?.stack,
        });
        process.exit(1);
    }
};

start();

export default app;
