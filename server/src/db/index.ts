import { Pool } from 'pg';
import dotenv from 'dotenv';
dotenv.config();

// Since we're mocking local storage first, check if a connection string is provided
// If not, we can assume a basic default or just rely on the env var being set later.
const pool = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/teledrive',
});

// Helper to initialize DB tables
export const initDB = async () => {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                phone VARCHAR(20) UNIQUE NOT NULL,
                telegram_id VARCHAR(50),
                session_string TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS folders (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                name VARCHAR(100) NOT NULL,
                parent_id INTEGER REFERENCES folders(id) ON DELETE CASCADE,
                color VARCHAR(20) DEFAULT '#405de6',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS files (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                folder_id INTEGER REFERENCES folders(id) ON DELETE SET NULL,
                telegram_message_id BIGINT,
                name VARCHAR(255) NOT NULL,
                mime_type VARCHAR(100),
                size BIGINT,
                url TEXT,           -- For mock purposes or direct cached URLs
                thumbnail_url TEXT, -- For grid views
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);
        console.log('✅ Database schema initialized successfully');
    } catch (err) {
        console.error('❌ Error initializing database schema:', err);
    }
};

export default pool;
