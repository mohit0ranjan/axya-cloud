const dotenv = require('dotenv');
dotenv.config();

const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function test() {
    try {
        console.log("Creating link...");

        // Find any user
        const userRes = await pool.query('SELECT id FROM users LIMIT 1');
        if (userRes.rows.length === 0) {
            console.log("No users found");
            return;
        }
        const userId = userRes.rows[0].id;

        // Give them a file
        const fileRes = await pool.query(`INSERT INTO files (user_id, file_name, telegram_file_id, telegram_message_id) 
            VALUES ($1, 'test.txt', 'fid', 1) RETURNING id`, [userId]);
        const fileId = fileRes.rows[0].id;

        // Hash a password using the current scheme
        const crypto = require('crypto');
        const getSharePasswordPepper = () => process.env.SHARE_PASSWORD_PEPPER || process.env.COOKIE_SECRET || 'axya_share_password_pepper';
        const hashSharePassword = (password) => {
            const digest = crypto
                .createHash('sha256')
                .update(`${getSharePasswordPepper()}|${password}`, 'utf8')
                .digest('hex');
            return `sha256:${digest}`;
        };
        const passHash = hashSharePassword('password123');

        // Create a share link
        const token = crypto.randomBytes(16).toString('hex');
        await pool.query(`INSERT INTO shared_links (token, file_id, created_by, password_hash) 
            VALUES ($1, $2, $3, $4)`, [token, fileId, userId, passHash]);

        console.log(`Link created: ${token}`);

        // Try hitting the API hitting the running local server, if it is running
        try {
            const res = await fetch(`http://localhost:3000/share/${token}/password`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password: 'password123' })
            });
            console.log("API Status:", res.status);
            console.log("API Body:", await res.text());
        } catch (e) {
            console.error("API Error (Server might not be running):", e.message);
        }

    } catch (e) {
        console.error(e);
    } finally {
        pool.end();
    }
}
test();
