import pool from '../config/db';

export const initSchema = async () => {
  // ✅ SAFE: Only creates, never drops. Use migrations if schema changes are needed.
  const schema = `
        CREATE EXTENSION IF NOT EXISTS "pgcrypto";

        CREATE TABLE IF NOT EXISTS users (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            phone TEXT UNIQUE NOT NULL,
            session_string TEXT NOT NULL,
            name TEXT,
            username TEXT,
            profile_pic TEXT,
            plan TEXT DEFAULT 'free',
            storage_quota_bytes BIGINT DEFAULT 5368709120,
            last_active_at TIMESTAMP,
            created_at TIMESTAMP DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS folders (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id UUID REFERENCES users(id) ON DELETE CASCADE,
            name TEXT NOT NULL,
            parent_id UUID REFERENCES folders(id) ON DELETE CASCADE,
            is_trashed BOOLEAN DEFAULT false,
            trashed_at TIMESTAMP,
            color TEXT DEFAULT '#3174ff',
            created_at TIMESTAMP DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS files (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id UUID REFERENCES users(id) ON DELETE CASCADE,
            folder_id UUID REFERENCES folders(id) ON DELETE SET NULL,
            file_name TEXT NOT NULL,
            file_size BIGINT DEFAULT 0,
            telegram_file_id TEXT NOT NULL,
            telegram_message_id BIGINT NOT NULL,
            telegram_chat_id TEXT DEFAULT 'me',
            mime_type TEXT,
            is_trashed BOOLEAN DEFAULT false,
            trashed_at TIMESTAMP,
            is_starred BOOLEAN DEFAULT false,
            sha256_hash TEXT,
            created_at TIMESTAMP DEFAULT NOW(),
            updated_at TIMESTAMP DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS shared_links (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            file_id UUID REFERENCES files(id) ON DELETE CASCADE,
            token TEXT UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(24), 'hex'),
            expires_at TIMESTAMP,
            created_by UUID REFERENCES users(id),
            is_public BOOLEAN DEFAULT true,
            download_count INT DEFAULT 0,
            created_at TIMESTAMP DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS activity_log (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id UUID REFERENCES users(id) ON DELETE CASCADE,
            action TEXT NOT NULL,
            file_id UUID,
            folder_id UUID,
            meta JSONB DEFAULT '{}',
            created_at TIMESTAMP DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS file_tags (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            file_id UUID REFERENCES files(id) ON DELETE CASCADE,
            user_id UUID REFERENCES users(id) ON DELETE CASCADE,
            tag TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT NOW(),
            UNIQUE(file_id, tag)
        );

        CREATE INDEX IF NOT EXISTS idx_files_user_folder ON files (user_id, folder_id);
        CREATE INDEX IF NOT EXISTS idx_activity_user ON activity_log(user_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_file_tags_user ON file_tags(user_id, tag);
    `;

  // Safe additive migrations: add columns if they don't exist
  const migrations = [
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS plan TEXT DEFAULT 'free'`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS storage_quota_bytes BIGINT DEFAULT 5368709120`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS last_active_at TIMESTAMP`,
    `ALTER TABLE files ADD COLUMN IF NOT EXISTS is_trashed BOOLEAN DEFAULT false`,
    `ALTER TABLE files ADD COLUMN IF NOT EXISTS trashed_at TIMESTAMP`,
    `ALTER TABLE files ADD COLUMN IF NOT EXISTS is_starred BOOLEAN DEFAULT false`,
    `ALTER TABLE files ADD COLUMN IF NOT EXISTS sha256_hash TEXT`,
    `ALTER TABLE files ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW()`,
    `ALTER TABLE files ADD COLUMN IF NOT EXISTS telegram_chat_id TEXT DEFAULT 'me'`,
    `ALTER TABLE files ADD COLUMN IF NOT EXISTS last_accessed_at TIMESTAMP`,
    `ALTER TABLE folders ADD COLUMN IF NOT EXISTS is_trashed BOOLEAN DEFAULT false`,
    `ALTER TABLE folders ADD COLUMN IF NOT EXISTS trashed_at TIMESTAMP`,
    `ALTER TABLE folders ADD COLUMN IF NOT EXISTS color TEXT DEFAULT '#3174ff'`,
    // Indexes on new columns
    `CREATE INDEX IF NOT EXISTS idx_files_user_trashed ON files (user_id, is_trashed)`,
    `CREATE INDEX IF NOT EXISTS idx_files_starred ON files (user_id) WHERE is_starred = true`,
    `CREATE INDEX IF NOT EXISTS idx_files_name_search ON files (user_id, file_name)`,
    `CREATE INDEX IF NOT EXISTS idx_files_accessed ON files (user_id, last_accessed_at DESC NULLS LAST)`,
    `CREATE INDEX IF NOT EXISTS idx_folders_user_parent ON folders (user_id, parent_id)`,
    `CREATE INDEX IF NOT EXISTS idx_folders_user_trashed ON folders (user_id, is_trashed)`,
    `CREATE INDEX IF NOT EXISTS idx_shared_links_token ON shared_links(token)`,
    `CREATE TABLE IF NOT EXISTS file_tags (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), file_id UUID REFERENCES files(id) ON DELETE CASCADE, user_id UUID REFERENCES users(id) ON DELETE CASCADE, tag TEXT NOT NULL, created_at TIMESTAMP DEFAULT NOW(), UNIQUE(file_id, tag))`,
    `ALTER TABLE files ADD COLUMN IF NOT EXISTS md5_hash TEXT`,
    `CREATE INDEX IF NOT EXISTS idx_files_hash ON files (sha256_hash) WHERE sha256_hash IS NOT NULL`,
    `CREATE INDEX IF NOT EXISTS idx_files_user_hash ON files (user_id, sha256_hash) WHERE sha256_hash IS NOT NULL`,
    `CREATE INDEX IF NOT EXISTS idx_files_md5 ON files (md5_hash) WHERE md5_hash IS NOT NULL`,
    `CREATE INDEX IF NOT EXISTS idx_files_user_md5 ON files (user_id, md5_hash) WHERE md5_hash IS NOT NULL`,
    // ✅ Composite index for fast sort queries (name, date, size) per user+folder
    `CREATE INDEX IF NOT EXISTS idx_files_sort_date ON files (user_id, folder_id, created_at DESC) WHERE is_trashed = false`,
    `CREATE INDEX IF NOT EXISTS idx_files_sort_name ON files (user_id, folder_id, file_name ASC) WHERE is_trashed = false`,
    `CREATE INDEX IF NOT EXISTS idx_files_sort_size ON files (user_id, folder_id, file_size DESC) WHERE is_trashed = false`,
    // ✅ FIX C3: Clean up existing duplicate rows before creating the unique index to prevent migration failure
    `DELETE FROM files WHERE id IN (SELECT id FROM (SELECT id, ROW_NUMBER() OVER(PARTITION BY user_id, sha256_hash ORDER BY created_at DESC) as row_num FROM files WHERE sha256_hash IS NOT NULL AND is_trashed = false) t WHERE t.row_num > 1)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS files_user_sha256_unique ON files (user_id, sha256_hash) WHERE sha256_hash IS NOT NULL AND is_trashed = false`,

    // ✅ Fix 1.3: Trigger-based storage counters — eliminate live SUM()/COUNT() scans
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS storage_used_bytes BIGINT DEFAULT 0`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS total_files_count INT DEFAULT 0`,
    // Back-fill existing data once (idempotent via UPDATE ... FROM)
    `UPDATE users u SET
       storage_used_bytes = COALESCE(s.used_bytes, 0),
       total_files_count  = COALESCE(s.cnt, 0)
     FROM (
       SELECT user_id, SUM(file_size) AS used_bytes, COUNT(*)::int AS cnt
       FROM files
       WHERE is_trashed = false
       GROUP BY user_id
     ) s
     WHERE u.id = s.user_id`,
    // Trigger function: adjusts counters on INSERT, DELETE, and is_trashed UPDATE
    `CREATE OR REPLACE FUNCTION update_user_storage_counters()
     RETURNS TRIGGER LANGUAGE plpgsql AS $$
     BEGIN
       IF TG_OP = 'INSERT' AND NOT NEW.is_trashed THEN
         UPDATE users SET storage_used_bytes = storage_used_bytes + COALESCE(NEW.file_size,0),
                          total_files_count  = total_files_count  + 1
         WHERE id = NEW.user_id;
       ELSIF TG_OP = 'DELETE' AND NOT OLD.is_trashed THEN
         UPDATE users SET storage_used_bytes = GREATEST(0, storage_used_bytes - COALESCE(OLD.file_size,0)),
                          total_files_count  = GREATEST(0, total_files_count  - 1)
         WHERE id = OLD.user_id;
       ELSIF TG_OP = 'UPDATE' AND OLD.is_trashed <> NEW.is_trashed THEN
         IF NEW.is_trashed THEN
           -- file trashed: subtract
           UPDATE users SET storage_used_bytes = GREATEST(0, storage_used_bytes - COALESCE(NEW.file_size,0)),
                            total_files_count  = GREATEST(0, total_files_count  - 1)
           WHERE id = NEW.user_id;
         ELSE
           -- file restored: add back
           UPDATE users SET storage_used_bytes = storage_used_bytes + COALESCE(NEW.file_size,0),
                            total_files_count  = total_files_count  + 1
           WHERE id = NEW.user_id;
         END IF;
       END IF;
       RETURN NULL;
     END;
     $$`,
    `DROP TRIGGER IF EXISTS trg_user_storage_counters ON files`,
    `CREATE TRIGGER trg_user_storage_counters
     AFTER INSERT OR DELETE OR UPDATE OF is_trashed, file_size ON files
     FOR EACH ROW EXECUTE FUNCTION update_user_storage_counters()`,
  ];

  try {
    await pool.query(schema);
    console.log('✅ PostgreSQL Schema initialized successfully.');

    for (const migration of migrations) {
      try {
        await pool.query(migration);
      } catch (e: any) {
        if (!e.message?.includes('already exists')) {
          console.warn('Migration warning:', e.message);
        }
      }
    }
    console.log('✅ Migrations applied.');
  } catch (error) {
    console.error('❌ Error initializing database schema:', error);
    throw error;
  }
};

export const getDbPool = () => pool;
