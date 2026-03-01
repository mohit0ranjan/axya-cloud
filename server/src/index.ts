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

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

// ── Security Middleware ─────────────────────────────────────────────────────
app.use(helmet());

const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:8081,http://localhost:3000').split(',');
app.use(cors({
    origin: (origin, callback) => {
        // Allow requests with no origin (mobile apps, curl)
        if (!origin || allowedOrigins.includes(origin)) {
            callback(null, true);
        } else {
            callback(new Error('Not allowed by CORS'));
        }
    },
    credentials: true,
}));

// ── Body Parsing ────────────────────────────────────────────────────────────
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// ── Global Rate Limiting ───────────────────────────────────────────────────
const globalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 200,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, error: 'Too many requests, please try again later.' },
});
app.use(globalLimiter);

// Strict limiter for auth endpoints
const authLimiter = rateLimit({
    windowMs: 10 * 60 * 1000,
    max: 10,
    message: { success: false, error: 'Too many auth attempts, please wait 10 minutes.' },
});

// ── Routes ──────────────────────────────────────────────────────────────────
app.use('/auth', authLimiter, authRoutes);
app.use('/files', fileRoutes);
app.use('/share', shareRoutes);

// ── Health Check ────────────────────────────────────────────────────────────
app.get('/health', (req: Request, res: Response) => {
    res.json({ status: 'OK', service: 'TeleDrive API', timestamp: new Date() });
});

// ── Global Error Handler ────────────────────────────────────────────────────
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
    console.error('[UnhandledError]', err.message);
    if (res.headersSent) return next(err);
    res.status(500).json({ success: false, error: 'Internal Server Error' });
});

// ── Graceful Shutdown ────────────────────────────────────────────────────────
const shutdown = async (signal: string) => {
    console.log(`\n🛑 ${signal} received. Cleaning up...`);
    if (signal === 'SIGINT') console.trace('Signal origin:');
    try {
        await pool.end();
        console.log('✅ Connections closed. Process exit.');
    } catch (e) { }
    process.exit(0);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// ── Startup ──────────────────────────────────────────────────────────────────
const start = async () => {
    try {
        console.log(`⏳ Starting TeleDrive on Port ${port}...`);
        await initSchema();

        app.listen(port, () => {
            console.log(`🚀 TeleDrive Server is READY!`);
            console.log(`🔗 Interface: http://localhost:${port}`);
        });
    } catch (error: any) {
        console.error('❌ Failed to start server:', error.message);
        process.exit(1);
    }
};

start();

export default app;
