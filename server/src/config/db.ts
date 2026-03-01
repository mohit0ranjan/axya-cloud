import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

// Neon DB connection or local Postgres
const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
    console.error('❌ CRITICAL: DATABASE_URL is not defined in environment variables.');
    console.error('💡 If deploying to Railway, add it in the "Variables" tab.');
}

// Silence PG warnings about SSL modes
let finalUrl = connectionString || '';
if (finalUrl && !finalUrl.includes('localhost') && !finalUrl.includes('127.0.0.1')) {
    if (!finalUrl.includes('sslmode=')) {
        // Updated to verify-full to satisfy newer pg versions and remove security warnings
        finalUrl += finalUrl.includes('?') ? '&sslmode=verify-full' : '?sslmode=verify-full';
    } else {
        finalUrl = finalUrl.replace(/sslmode=(require|prefer|verify-ca)/, 'sslmode=verify-full');
    }
}

const pool = new Pool({
    connectionString: finalUrl,
    ssl: finalUrl.includes('sslmode=verify-full') ? { rejectUnauthorized: false } : false,
    connectionTimeoutMillis: 10000, // 10s timeout to prevent infinite hangs
});

// Detailed error logging
pool.on('error', (err) => {
    console.error('🧨 [Database Pool Error]', err.message);
    if (err.message.includes('SSL')) {
        console.error('💡 SSL connectivity issue detected. Check DATABASE_URL query params.');
    }
});

export default pool;
