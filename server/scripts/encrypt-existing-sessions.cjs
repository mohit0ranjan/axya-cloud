require('dotenv').config();
const pool = require('../dist/config/db').default;
const { encryptSession, isEncryptedSession } = require('../dist/utils/sessionEncryption');
(async () => {
  encryptSession('validate-key');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const rows = await client.query('SELECT id, session_string FROM users FOR UPDATE');
    let count = 0;
    for (const row of rows.rows) {
      if (!row.session_string || isEncryptedSession(row.session_string)) continue;
      await client.query('UPDATE users SET session_string = $1 WHERE id = $2', [encryptSession(row.session_string), row.id]);
      count++;
    }
    await client.query('COMMIT');
    console.log(`Encrypted ${count} legacy sessions. Keep SESSION_ENCRYPTION_KEY backed up securely.`);
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); await pool.end(); }
})().catch(() => { console.error('Session encryption migration failed; transaction rolled back. Check database access and encryption key.'); process.exitCode = 1; });
