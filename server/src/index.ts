import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { initSchema } from './services/db.service';
import pool from './config/db';
import authRoutes from './routes/auth.routes';
import fileRoutes from './routes/file.routes';
import shareRoutes from './routes/share.routes';
import streamRoutes from './routes/stream.routes';
import { logger } from './utils/logger';

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

// Logging all incoming requests (less verbose in production)
app.use((req, res, next) => {
    const startedAt = Date.now();
    res.on('finish', () => {
        logger.info('backend.http', 'request.complete', {
            method: req.method,
            url: req.originalUrl || req.url,
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
app.use(helmet());

const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:8081,http://localhost:3000').split(',');
console.log(`🔒 [CORS] Configured origins:`, allowedOrigins);

app.use(cors({
    origin: (origin, callback) => {
        // Allow requests with no origin (mobile apps, curl, Expo Go)
        if (!origin || allowedOrigins.includes(origin)) {
            callback(null, true);
        } else {
            console.error(`🛑 [CORS Error] Origin rejected: ${origin}`);
            callback(new Error('Not allowed by CORS'));
        }
    },
    credentials: true,
}));

// ── Body Parsing ────────────────────────────────────────────────────────────
// ⚠️ Reduced from 50mb to 10mb — chunks are sent individually, not whole file
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

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
app.use('/share', shareRoutes);
app.use('/stream', streamRoutes);

// ── Health Check (Render keep-alive friendly) ────────────────────────────────
app.get('/health', (req: Request, res: Response) => {
    res.json({
        status: 'OK',
        service: 'Axya API',
        timestamp: new Date(),
        uptime: Math.floor(process.uptime()),
        memory: process.memoryUsage().heapUsed,
    });
});

// ── Root route (prevents 404 on cold-start probe) ───────────────────────────
app.get('/', (req: Request, res: Response) => {
    res.json({ status: 'OK', service: 'Axya Cloud API', version: '1.0.0' });
});

// ── Global Error Handler ────────────────────────────────────────────────────
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
    logger.error('backend.http', 'unhandled_error', { method: req.method, url: req.originalUrl || req.url, message: err.message, stack: err.stack });
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
const start = async () => {
    try {
        console.log(`⏳ Starting Axya on Port ${port}...`);
        await initSchema();

        app.listen(port, () => {
            console.log(`🚀 Axya Server is READY!`);
            console.log(`🔗 Interface: http://localhost:${port}`);
            console.log(`📊 Node: ${process.version} | Env: ${process.env.NODE_ENV || 'development'}`);
        });
    } catch (error: any) {
        console.error('❌ Failed to start server:', error.message);
        process.exit(1);
    }
};

start();

export default app;
