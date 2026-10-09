const fs = require('node:fs'); const path = require('node:path'); const crypto = require('node:crypto');
const target = path.resolve(__dirname, '../.env');
if (fs.existsSync(target)) { console.log('Existing server .env preserved.'); process.exit(0); }
const secret = () => crypto.randomBytes(32).toString('hex');
fs.writeFileSync(target, `NODE_ENV=development
PORT=3000
# Fill these three fields in your editor. Never commit this file.
DATABASE_URL=
TELEGRAM_API_ID=
TELEGRAM_API_HASH=
JWT_SECRET=${secret()}
COOKIE_SECRET=${secret()}
SESSION_ENCRYPTION_KEY=${secret()}
ALLOWED_ORIGINS=http://localhost:3001,http://localhost:8081
SERVER_BASE_URL=http://localhost:3000
FRONTEND_BASE_URL=http://localhost:3001
WEB_PUBLIC_BASE_URL=http://localhost:3001
SHARE_PUBLIC_BASE_URL=http://localhost:3001
# Use an absolute persistent-volume path when deploying.
UPLOAD_STORAGE_DIR=./data/uploads
UPLOAD_MAX_FILE_SIZE_BYTES=1073741824
ALLOW_LEGACY_STORAGE_READS=false
`, { flag: 'wx', mode: 0o600 });
console.log('Created ignored server/.env with independent random application secrets. Fill DATABASE_URL, TELEGRAM_API_ID and TELEGRAM_API_HASH in your editor.');
