import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

// Neon DB connection or local Postgres
let connectionString = process.env.DATABASE_URL || '';

// Silence PG warnings about SSL modes
if (connectionString && !connectionString.includes('localhost') && !connectionString.includes('127.0.0.1')) {
    if (!connectionString.includes('sslmode=')) {
        connectionString += connectionString.includes('?') ? '&sslmode=require' : '?sslmode=require';
    }
}

const pool = new Pool({
    connectionString,
    ssl: connectionString.includes('sslmode=require') ? { rejectUnauthorized: false } : false,
});

// Detailed error logging
pool.on('error', (err) => {
    console.error('🧨 [Database Pool Error]', err.message);
    if (err.message.includes('SSL')) {
        console.error('💡 SSL connectivity issue detected. Check DATABASE_URL query params.');
    }
});

export default pool;
