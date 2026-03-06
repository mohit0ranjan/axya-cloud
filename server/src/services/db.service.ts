import pool from '../config/db';

export const initSchema = async () => {
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
            folder_id UUID REFERENCES folders(id) ON DELETE CASCADE,
            token TEXT UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(24), 'hex'),
            expires_at TIMESTAMP,
            created_by UUID NOT NULL REFERENCES users(id),
            password_hash TEXT,
            allow_download BOOLEAN DEFAULT true,
            view_only BOOLEAN DEFAULT false,
            views INT DEFAULT 0,
            is_public BOOLEAN DEFAULT true,
            download_count INT DEFAULT 0,
            created_at TIMESTAMP DEFAULT NOW(),
            CONSTRAINT share_target_check
              CHECK ((file_id IS NOT NULL AND folder_id IS NULL) OR (file_id IS NULL AND folder_id IS NOT NULL))
        );

        CREATE TABLE IF NOT EXISTS shares (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            file_id UUID REFERENCES files(id) ON DELETE CASCADE,
            folder_id UUID REFERENCES folders(id) ON DELETE CASCADE,
            password_hash TEXT,
            expires_at TIMESTAMP,
            created_at TIMESTAMP DEFAULT NOW(),
            created_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            allow_download BOOLEAN DEFAULT true,
            view_only BOOLEAN DEFAULT false,
            views INT DEFAULT 0,
            download_count INT DEFAULT 0,
            CONSTRAINT shares_target_check
              CHECK ((file_id IS NOT NULL AND folder_id IS NULL) OR (file_id IS NULL AND folder_id IS NOT NULL))
        );

        CREATE TABLE IF NOT EXISTS shared_spaces (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            name TEXT NOT NULL,
            owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            password_hash TEXT,
            allow_upload BOOLEAN NOT NULL DEFAULT false,
            allow_download BOOLEAN NOT NULL DEFAULT true,
            expires_at TIMESTAMP,
            created_at TIMESTAMP NOT NULL DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS shared_files (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            space_id UUID NOT NULL REFERENCES shared_spaces(id) ON DELETE CASCADE,
            telegram_message_id BIGINT NOT NULL,
            file_name TEXT NOT NULL,
            file_size BIGINT NOT NULL DEFAULT 0,
            mime_type TEXT,
            uploaded_by UUID REFERENCES users(id) ON DELETE SET NULL,
            telegram_file_id TEXT,
            folder_path TEXT NOT NULL DEFAULT '/',
            created_at TIMESTAMP NOT NULL DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS access_logs (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            space_id UUID NOT NULL REFERENCES shared_spaces(id) ON DELETE CASCADE,
            user_ip TEXT NOT NULL,
            action TEXT NOT NULL,
            created_at TIMESTAMP NOT NULL DEFAULT NOW()
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
    `ALTER TABLE shared_links ADD COLUMN IF NOT EXISTS folder_id UUID REFERENCES folders(id) ON DELETE CASCADE`,
    `ALTER TABLE shared_links ADD COLUMN IF NOT EXISTS password_hash TEXT`,
    `ALTER TABLE shared_links ADD COLUMN IF NOT EXISTS allow_download BOOLEAN DEFAULT true`,
    `ALTER TABLE shared_links ADD COLUMN IF NOT EXISTS view_only BOOLEAN DEFAULT false`,
    `ALTER TABLE shared_links ADD COLUMN IF NOT EXISTS views INT DEFAULT 0`,
    `ALTER TABLE shared_links ALTER COLUMN file_id DROP NOT NULL`,
    `DELETE FROM shared_links WHERE file_id IS NULL AND folder_id IS NULL`,
    `DELETE FROM shared_links WHERE created_by IS NULL`,
    `ALTER TABLE shared_links ALTER COLUMN created_by SET NOT NULL`,
    `DO $$ BEGIN ALTER TABLE shared_links ADD CONSTRAINT share_target_check CHECK ((file_id IS NOT NULL AND folder_id IS NULL) OR (file_id IS NULL AND folder_id IS NOT NULL)); EXCEPTION WHEN duplicate_object THEN null; END $$;`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_shared_links_file ON shared_links (created_by, file_id) WHERE file_id IS NOT NULL`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_shared_links_folder ON shared_links (created_by, folder_id) WHERE folder_id IS NOT NULL`,
    `CREATE OR REPLACE FUNCTION validate_shared_link_owner()
     RETURNS TRIGGER LANGUAGE plpgsql AS $$
     DECLARE
       owner_id UUID;
     BEGIN
       IF NEW.file_id IS NOT NULL THEN
         SELECT user_id INTO owner_id FROM files WHERE id = NEW.file_id;
         IF owner_id IS NULL THEN
           RAISE EXCEPTION 'shared_links file_id does not reference an existing file';
         END IF;
         IF owner_id <> NEW.created_by THEN
           RAISE EXCEPTION 'shared_links.created_by must match files.user_id';
         END IF;
       ELSIF NEW.folder_id IS NOT NULL THEN
         SELECT user_id INTO owner_id FROM folders WHERE id = NEW.folder_id;
         IF owner_id IS NULL THEN
           RAISE EXCEPTION 'shared_links folder_id does not reference an existing folder';
         END IF;
         IF owner_id <> NEW.created_by THEN
           RAISE EXCEPTION 'shared_links.created_by must match folders.user_id';
         END IF;
       END IF;
       RETURN NEW;
     END;
     $$`,
    `DROP TRIGGER IF EXISTS trg_validate_shared_link_owner ON shared_links`,
    `CREATE TRIGGER trg_validate_shared_link_owner
     BEFORE INSERT OR UPDATE OF file_id, folder_id, created_by ON shared_links
     FOR EACH ROW EXECUTE FUNCTION validate_shared_link_owner()`,
    `CREATE INDEX IF NOT EXISTS idx_files_sort_date ON files (user_id, folder_id, created_at DESC) WHERE is_trashed = false`,
    `CREATE INDEX IF NOT EXISTS idx_files_sort_name ON files (user_id, folder_id, file_name ASC) WHERE is_trashed = false`,
    `CREATE INDEX IF NOT EXISTS idx_files_sort_size ON files (user_id, folder_id, file_size DESC) WHERE is_trashed = false`,
    `DELETE FROM files WHERE id IN (SELECT id FROM (SELECT id, ROW_NUMBER() OVER(PARTITION BY user_id, sha256_hash ORDER BY created_at DESC) as row_num FROM files WHERE sha256_hash IS NOT NULL AND is_trashed = false) t WHERE t.row_num > 1)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS files_user_sha256_unique ON files (user_id, sha256_hash) WHERE sha256_hash IS NOT NULL AND is_trashed = false`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS storage_used_bytes BIGINT DEFAULT 0`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS total_files_count INT DEFAULT 0`,
    `ALTER TABLE shared_files ADD COLUMN IF NOT EXISTS telegram_file_id TEXT`,
    `ALTER TABLE shared_files ADD COLUMN IF NOT EXISTS folder_path TEXT NOT NULL DEFAULT '/'`,
    `CREATE INDEX IF NOT EXISTS idx_shared_spaces_owner ON shared_spaces (owner_id, created_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_shared_spaces_expires ON shared_spaces (expires_at)`,
    `CREATE INDEX IF NOT EXISTS idx_shares_created_by ON shares (created_by, created_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_shares_folder_id ON shares (folder_id) WHERE folder_id IS NOT NULL`,
    `CREATE INDEX IF NOT EXISTS idx_shares_file_id ON shares (file_id) WHERE file_id IS NOT NULL`,
    `CREATE INDEX IF NOT EXISTS idx_shares_expires_at ON shares (expires_at)`,
    `CREATE INDEX IF NOT EXISTS idx_shared_files_space ON shared_files (space_id, created_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_shared_files_space_folder ON shared_files (space_id, folder_path)`,
    `CREATE INDEX IF NOT EXISTS idx_access_logs_space ON access_logs (space_id, created_at DESC)`,
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
           UPDATE users SET storage_used_bytes = GREATEST(0, storage_used_bytes - COALESCE(NEW.file_size,0)),
                            total_files_count  = GREATEST(0, total_files_count  - 1)
           WHERE id = NEW.user_id;
         ELSE
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

  const criticalMigrationPatterns = [
    'ALTER TABLE shared_links ALTER COLUMN created_by SET NOT NULL',
    'ADD CONSTRAINT share_target_check',
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_shared_links_file',
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_shared_links_folder',
    'CREATE OR REPLACE FUNCTION validate_shared_link_owner()',
    'CREATE TRIGGER trg_validate_shared_link_owner',
  ];

  try {
    await pool.query(schema);
    console.log('Schema initialized.');

    for (const migration of migrations) {
      try {
        await pool.query(migration);
      } catch (e: any) {
        const isCritical = criticalMigrationPatterns.some((p) => migration.includes(p));
        if (isCritical) {
          console.error('Critical migration failed:', e.message);
          throw e;
        }
        if (!e.message?.includes('already exists')) {
          console.warn('Migration warning:', e.message);
        }
      }
    }

    const integrityCheck = await pool.query(`
      SELECT
        EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'share_target_check') AS has_xor_check,
        EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_shared_links_file') AS has_file_unique,
        EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_shared_links_folder') AS has_folder_unique,
        EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_validate_shared_link_owner') AS has_owner_trigger
    `);
    const row = integrityCheck.rows[0] || {};
    if (!row.has_xor_check || !row.has_file_unique || !row.has_folder_unique || !row.has_owner_trigger) {
      throw new Error('shared_links integrity checks/indexes/triggers are missing after migrations');
    }

    console.log('Migrations applied.');
  } catch (error) {
    console.error('Error initializing database schema:', error);
    throw error;
  }
};

export const getDbPool = () => pool;
