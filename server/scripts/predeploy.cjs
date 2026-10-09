// Render's pre-deploy container has no persistent disk. Only check config and DB here.
require('dotenv').config({ quiet: true });

(async () => {
    let pool;
    try {
        require('../dist/utils/productionConfig').assertProductionConfig();
        const { encryptSession, decryptSession, isEncryptedSession } = require('../dist/utils/sessionEncryption');
        encryptSession('predeploy-key-check');
        pool = require('../dist/config/db').default;
        const exists = await pool.query("SELECT to_regclass('public.users') IS NOT NULL AS present");
        let checked = 0;
        if (exists.rows[0].present) {
            let cursor = null;
            while (true) {
                const result = await pool.query(
                    'SELECT id, session_string FROM users WHERE ($1::uuid IS NULL OR id > $1::uuid) ORDER BY id LIMIT 100', [cursor]);
                if (!result.rows.length) break;
                for (const row of result.rows) {
                    if (row.session_string && isEncryptedSession(row.session_string)) {
                        // Authenticate the ciphertext before making any schema changes.
                        decryptSession(row.session_string);
                        checked++;
                    }
                }
                cursor = result.rows[result.rows.length - 1].id;
            }
        }
        console.log(`Configuration and ${checked} encrypted Telegram sessions verified.`);
        await require('../dist/services/db.service').initSchema();
        console.log('Pre-deploy database migration complete. Upload disk is checked at runtime.');
    } catch {
        // Errors may contain a database URL or session data. Never print their contents.
        console.error('Pre-deploy failed. Check required environment variables, database access and the ORIGINAL session encryption key. No deployment should proceed.');
        process.exitCode = 1;
    } finally {
        if (pool) await pool.end();
    }
})();
