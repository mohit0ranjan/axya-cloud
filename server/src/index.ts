import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import helmet from 'helmet';
import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
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

dotenv.config();

const app = express();
const port = Number(process.env.PORT) || 3000;
const isProduction = process.env.NODE_ENV === 'production';
const REQUIRED_NODE_MAJOR = 20;
const SCHEMA_RETRY_DELAY_MS = 5000;
const SCHEMA_MAX_RETRIES = 12;
const SCHEMA_RETRY_AFTER_SECONDS = Math.max(1, Math.ceil(SCHEMA_RETRY_DELAY_MS / 1000));
const redactSensitiveQuery = (url: string) =>
    url
        .replace(/([?&](?:token|password|otp|code)=)[^&]*/gi, '$1[redacted]')
        .replace(/([?&](?:authorization)=)[^&]*/gi, '$1[redacted]');

let schemaReady = false;
let schemaInitAttempts = 0;
let schemaLastError = '';
let schemaState: 'starting' | 'ready' | 'degraded' = 'starting';
let telegramWarmupStatus: 'idle' | 'ready' | 'partial' | 'failed' | 'skipped' = 'idle';

app.disable('x-powered-by');

// Logging all incoming requests (less verbose in production)
app.use((req, res, next) => {
    const startedAt = Date.now();
    res.on('finish', () => {
        logger.info('backend.http', 'request.complete', {
            method: req.method,
            url: redactSensitiveQuery(req.originalUrl || req.url || ''),
            status: res.statusCode,
            durationMs: Date.now() - startedAt,
            ip: req.ip,
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

const defaultAllowedOrigins = [
    'https://axyzcloud-a8fgczdhhjhxexhg.centralindia-01.azurewebsites.net',
    'http://localhost:8081',
    'http://localhost:8080',
    'http://localhost:3000',
    'http://127.0.0.1:8081',
    'http://127.0.0.1:8080',
    'http://127.0.0.1:3000',
];
const allowedOrigins = Array.from(
    new Set(
        (process.env.ALLOWED_ORIGINS || defaultAllowedOrigins.join(','))
            .split(',')
            .map((origin) => origin.trim())
            .filter(Boolean)
    )
);
const isAllowedOrigin = (origin?: string) => {
    if (!origin) return true;
    if (allowedOrigins.includes(origin)) return true;
    return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin);
};
const corsOptions: cors.CorsOptions = {
    origin: (origin, callback) => {
        if (isAllowedOrigin(origin)) {
            return callback(null, true);
        }
        logger.warn('backend.http', 'cors.blocked_origin', { origin });
        return callback(new Error('Origin not allowed by CORS'));
    },
    credentials: true,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type', 'X-Requested-With'],
    optionsSuccessStatus: 204,
};
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
    if (req.path === '/' || req.path === '/health') return next();
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
            details: { schemaState },
        }
    );
});

// ── Global Rate Limiting ───────────────────────────────────────────────────
// ✅ Raised from 200 to 1000 — 100 photos × (init + chunks + complete) = 400+ requests
const globalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 1000,                 // ✅ was 200 — too strict for batch uploads
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => {
        // ✅ Skip rate limiting for health check endpoint
        return req.path === '/health';
    },
    message: { success: false, error: 'Too many requests, please try again in 15 minutes.' },
});
app.use(globalLimiter);

// Strict limiter for auth endpoints — prevent OTP brute force
const authLimiter = rateLimit({
    windowMs: 10 * 60 * 1000,
    max: 15,  // ✅ was 10, slightly raised to allow 5 phone numbers + retries
    message: { success: false, error: 'Too many auth attempts, please wait 10 minutes.' },
});

// ── Routes ──────────────────────────────────────────────────────────────────
app.use('/auth', authLimiter, authRoutes);
app.use('/files', fileRoutes);
app.use('/api/v2', shareV2Routes);
app.use('/stream', streamRoutes);

// ── Health Check (Render keep-alive friendly) ────────────────────────────────
app.get('/health', (req: Request, res: Response) => {
    res.json({
        status: schemaReady ? 'OK' : 'DEGRADED',
        service: 'Axya API',
        timestamp: new Date(),
        uptime: Math.floor(process.uptime()),
        memory: process.memoryUsage().heapUsed,
        schemaState,
        schemaReady,
        schemaInitAttempts,
        schemaLastError: schemaLastError || null,
        telegramWarmupStatus,
    });
});

// ── Root route (prevents 404 on cold-start probe) ───────────────────────────
app.get('/', (req: Request, res: Response) => {
    res.json({ status: 'OK', service: 'Axya Cloud API', version: '1.0.0' });
});

// ── Global Error Handler ────────────────────────────────────────────────────
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
    logger.error('backend.http', 'unhandled_error', {
        method: req.method,
        url: redactSensitiveQuery(req.originalUrl || req.url || ''),
        message: err.message,
        stack: err.stack,
    });
    if (res.headersSent) return next(err);

    // Handle multer errors
    if ((err as any).code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ success: false, error: 'File too large' });
    }

    res.status(500).json({ success: false, error: 'Internal Server Error' });
});

// ── Graceful Shutdown ────────────────────────────────────────────────────────
const shutdown = async (signal: string) => {
    console.log(`\n🛑 ${signal} received. Cleaning up...`);
    try {
        await pool.end();
        console.log('✅ Database connections closed.');
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
 * ✅ Fix 2.3: Wipe orphaned partial upload chunks on startup.
 * If the server was killed during an upload the temp files stay forever.
 * This runs synchronously before accepting any traffic.
 */
function cleanOrphanedUploads(): void {
    const tmpDir = path.join(os.tmpdir(), 'axya_uploads');
    try {
        if (fs.existsSync(tmpDir)) {
            fs.rmSync(tmpDir, { recursive: true, force: true });
            console.log('🧹 Cleaned orphaned upload temp directory.');
        }
        fs.mkdirSync(tmpDir, { recursive: true });
    } catch (e: any) {
        // Non-fatal — log and continue
        console.warn('⚠️  Could not clean temp uploads dir:', e.message);
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
        console.log(`⏳ Starting Axya on Port ${port}...`);
        enforceSupportedNodeRuntime();
        cleanOrphanedUploads();
        app.listen(port, '0.0.0.0', () => {
            console.log(`🚀 Axya Server is READY!`);
            console.log(`🔗 Interface: http://0.0.0.0:${port}`);
            console.log(`📊 Node: ${process.version} | Env: ${process.env.NODE_ENV || 'development'}`);
        });
        void initializeCoreServices();
    } catch (error: any) {
        console.error('❌ Failed to bind server:', error.message);
        process.exit(1);
    }
};

start();

export default app;
