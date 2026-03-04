import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

// Neon DB connection or local Postgres
const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
    console.error('❌ CRITICAL: DATABASE_URL is not defined in environment variables.');
    console.error('💡 If deploying to Render, add it in the "Environment" tab.');
}

// Silence PG warnings about SSL modes
let finalUrl = connectionString || '';
if (finalUrl && !finalUrl.includes('localhost') && !finalUrl.includes('127.0.0.1')) {
    if (!finalUrl.includes('sslmode=')) {
        finalUrl += finalUrl.includes('?') ? '&sslmode=require' : '?sslmode=require';
    }
}

// ✅ Optimized for Render free tier + Neon serverless:
// - max: 5 connections (prevent exhausting Neon free tier ~100 limit)
// - idleTimeoutMillis: 20s (release idle connections quickly — Render memory is limited)
// - connectionTimeoutMillis: 10s (fail fast on connectivity issues)
// - allowExitOnIdle: true (let Node.js exit cleanly when no DB work pending)
const pool = new Pool({
    connectionString: finalUrl,
    ssl: finalUrl.includes('sslmode=')
        ? { rejectUnauthorized: false }
        : false,
    max: 5,                        // ✅ was unlimited — 5 is plenty for a single Render dyno
    min: 1,                        // Keep 1 warm connection to avoid cold-start lag
    idleTimeoutMillis: 20_000,     // ✅ Release idle connections after 20s
    connectionTimeoutMillis: 10_000, // 10s to get a connection from pool
    allowExitOnIdle: false,        // Don't exit during keep-alive between requests
});

// Detailed error logging
pool.on('error', (err) => {
    if (err.message.includes('Connection terminated unexpectedly')) {
        console.warn('⚡ [DB] Neon serverless connection dropped (DB sleeping). Will auto-reconnect on next query.');
        return; // Non-fatal — pool self-heals
    }
    console.error('🧨 [Database Pool Error]', err.message);
    if (err.message.includes('SSL')) {
        console.error('💡 SSL issue. Check DATABASE_URL sslmode param.');
    }
    if (err.message.includes('timeout')) {
        console.error('💡 Connection timeout — Neon may be sleeping. Will retry on next request.');
    }
});

pool.on('connect', () => {
    if (process.env.NODE_ENV !== 'production') {
        console.log('🔌 [DB] New connection established');
    }
});

export default pool;
