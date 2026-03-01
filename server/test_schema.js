const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function run() {
    try {
        const res = await pool.query(`
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_name = 'files';
        `);
        console.log("FILES TABLE:", res.rows);
        const folderRes = await pool.query(`
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_name = 'folders';
        `);
        console.log("FOLDERS TABLE:", folderRes.rows);
        const logRes = await pool.query(`
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_name = 'activity_log';
        `);
        console.log("ACTIVITY LOG:", logRes.rows);
    } catch (e) {
        console.error(e);
    } finally {
        pool.end();
    }
}

run();
