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
            storage_used_bytes BIGINT DEFAULT 0,
            total_files_count INT DEFAULT 0,
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
            md5_hash TEXT,
            tg_media_meta JSONB NOT NULL DEFAULT '{}'::jsonb,
            tg_duration_sec INT,
            tg_width INT,
            tg_height INT,
            tg_caption TEXT,
            tg_source_tag TEXT,
            last_accessed_at TIMESTAMP,
            created_at TIMESTAMP DEFAULT NOW(),
            updated_at TIMESTAMP DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS share_links_v2 (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            owner_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            resource_type TEXT NOT NULL CHECK (resource_type IN ('file', 'folder')),
            root_file_id UUID REFERENCES files(id) ON DELETE SET NULL,
            root_folder_id UUID REFERENCES folders(id) ON DELETE SET NULL,
            slug TEXT UNIQUE NOT NULL,
            link_secret_hash TEXT NOT NULL,
            password_hash TEXT,
            allow_download BOOLEAN NOT NULL DEFAULT true,
            allow_preview BOOLEAN NOT NULL DEFAULT true,
            expires_at TIMESTAMP,
            revoked_at TIMESTAMP,
            created_at TIMESTAMP NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
            CONSTRAINT share_links_v2_root_xor
              CHECK ((root_file_id IS NOT NULL AND root_folder_id IS NULL) OR (root_file_id IS NULL AND root_folder_id IS NOT NULL))
        );

        CREATE TABLE IF NOT EXISTS share_items_v2 (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            share_id UUID NOT NULL REFERENCES share_links_v2(id) ON DELETE CASCADE,
            file_id UUID NOT NULL REFERENCES files(id) ON DELETE CASCADE,
            relative_path TEXT NOT NULL,
            display_name TEXT NOT NULL,
            mime_type TEXT,
            size_bytes BIGINT NOT NULL DEFAULT 0,
            telegram_chat_id TEXT NOT NULL,
            telegram_message_id BIGINT NOT NULL,
            telegram_file_id TEXT,
            position_index INT NOT NULL DEFAULT 0,
            created_at TIMESTAMP NOT NULL DEFAULT NOW(),
            CONSTRAINT share_items_v2_share_file_unique UNIQUE (share_id, file_id)
        );

        CREATE TABLE IF NOT EXISTS share_access_sessions_v2 (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            share_id UUID NOT NULL REFERENCES share_links_v2(id) ON DELETE CASCADE,
            session_token_hash TEXT NOT NULL,
            granted_at TIMESTAMP NOT NULL DEFAULT NOW(),
            expires_at TIMESTAMP NOT NULL,
            ip TEXT,
            user_agent TEXT,
            revoked_at TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS share_events_v2 (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            share_id UUID NOT NULL REFERENCES share_links_v2(id) ON DELETE CASCADE,
            event_type TEXT NOT NULL,
            item_id UUID,
            status_code INT,
            error_code TEXT,
            meta JSONB NOT NULL DEFAULT '{}'::jsonb,
            created_at TIMESTAMP NOT NULL DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS share_zip_jobs_v2 (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            share_id UUID NOT NULL REFERENCES share_links_v2(id) ON DELETE CASCADE,
            status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed')),
            requested_at TIMESTAMP NOT NULL DEFAULT NOW(),
            started_at TIMESTAMP,
            completed_at TIMESTAMP,
            expires_at TIMESTAMP,
            file_count INT NOT NULL DEFAULT 0,
            total_bytes BIGINT NOT NULL DEFAULT 0,
            zip_path TEXT,
            error_code TEXT,
            error_message TEXT
        );

        CREATE TABLE IF NOT EXISTS telegram_pointer_health (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            file_id UUID REFERENCES files(id) ON DELETE CASCADE,
            share_item_id UUID REFERENCES share_items_v2(id) ON DELETE CASCADE,
            telegram_chat_id TEXT NOT NULL,
            telegram_message_id BIGINT NOT NULL,
            pointer_status TEXT NOT NULL CHECK (pointer_status IN ('healthy', 'stale', 'missing', 'recovered')),
            failure_count INT NOT NULL DEFAULT 0,
            last_error_code TEXT,
            last_error_message TEXT,
            last_session_hash TEXT,
            last_checked_at TIMESTAMP NOT NULL DEFAULT NOW(),
            recovered_at TIMESTAMP,
            created_at TIMESTAMP NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
            CONSTRAINT telegram_pointer_health_target_xor
                CHECK ((file_id IS NOT NULL AND share_item_id IS NULL) OR (file_id IS NULL AND share_item_id IS NOT NULL))
        );

        CREATE TABLE IF NOT EXISTS telegram_request_queue_metrics (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            session_hash TEXT NOT NULL,
            operation_name TEXT NOT NULL,
            priority TEXT NOT NULL CHECK (priority IN ('interactive', 'background')),
            wait_ms INT NOT NULL DEFAULT 0,
            run_ms INT NOT NULL DEFAULT 0,
            status TEXT NOT NULL CHECK (status IN ('ok', 'error')),
            error_code TEXT,
            created_at TIMESTAMP NOT NULL DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS file_segment_manifests (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            file_id UUID NOT NULL REFERENCES files(id) ON DELETE CASCADE,
            mode TEXT NOT NULL DEFAULT 'single' CHECK (mode IN ('single', 'segmented')),
            chunk_size_bytes INT NOT NULL DEFAULT 0,
            segment_count INT NOT NULL DEFAULT 0,
            status TEXT NOT NULL DEFAULT 'disabled' CHECK (status IN ('disabled', 'scheduled', 'building', 'ready', 'failed')),
            telegram_chat_id TEXT,
            segments JSONB NOT NULL DEFAULT '[]'::jsonb,
            last_error TEXT,
            created_at TIMESTAMP NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
            CONSTRAINT file_segment_manifests_file_unique UNIQUE (file_id)
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

        CREATE TABLE IF NOT EXISTS file_access_log (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          file_id UUID NOT NULL REFERENCES files(id) ON DELETE CASCADE,
          user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          accessed_at TIMESTAMP NOT NULL DEFAULT NOW()
        );

        CREATE INDEX IF NOT EXISTS idx_files_user_folder ON files (user_id, folder_id);
        CREATE INDEX IF NOT EXISTS idx_activity_user ON activity_log(user_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_file_tags_user ON file_tags(user_id, tag);
        CREATE INDEX IF NOT EXISTS idx_file_access_log_file_time ON file_access_log(file_id, accessed_at DESC);
        CREATE INDEX IF NOT EXISTS idx_file_access_log_user_time ON file_access_log(user_id, accessed_at DESC);
    `;

  const migrations = [
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS plan TEXT DEFAULT 'free'`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS storage_quota_bytes BIGINT DEFAULT 5368709120`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS storage_used_bytes BIGINT DEFAULT 0`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS total_files_count INT DEFAULT 0`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS last_active_at TIMESTAMP`,
    `ALTER TABLE files ADD COLUMN IF NOT EXISTS is_trashed BOOLEAN DEFAULT false`,
    `ALTER TABLE files ADD COLUMN IF NOT EXISTS trashed_at TIMESTAMP`,
    `ALTER TABLE files ADD COLUMN IF NOT EXISTS is_starred BOOLEAN DEFAULT false`,
    `ALTER TABLE files ADD COLUMN IF NOT EXISTS sha256_hash TEXT`,
    `ALTER TABLE files ADD COLUMN IF NOT EXISTS md5_hash TEXT`,
    `ALTER TABLE files ADD COLUMN IF NOT EXISTS tg_media_meta JSONB NOT NULL DEFAULT '{}'::jsonb`,
    `ALTER TABLE files ADD COLUMN IF NOT EXISTS tg_duration_sec INT`,
    `ALTER TABLE files ADD COLUMN IF NOT EXISTS tg_width INT`,
    `ALTER TABLE files ADD COLUMN IF NOT EXISTS tg_height INT`,
    `ALTER TABLE files ADD COLUMN IF NOT EXISTS tg_caption TEXT`,
    `ALTER TABLE files ADD COLUMN IF NOT EXISTS tg_source_tag TEXT`,
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
    `CREATE TABLE IF NOT EXISTS file_tags (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), file_id UUID REFERENCES files(id) ON DELETE CASCADE, user_id UUID REFERENCES users(id) ON DELETE CASCADE, tag TEXT NOT NULL, created_at TIMESTAMP DEFAULT NOW(), UNIQUE(file_id, tag))`,
    `CREATE TABLE IF NOT EXISTS file_access_log (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), file_id UUID NOT NULL REFERENCES files(id) ON DELETE CASCADE, user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE, accessed_at TIMESTAMP NOT NULL DEFAULT NOW())`,
    `CREATE INDEX IF NOT EXISTS idx_files_hash ON files (sha256_hash) WHERE sha256_hash IS NOT NULL`,
    `CREATE INDEX IF NOT EXISTS idx_files_user_hash ON files (user_id, sha256_hash) WHERE sha256_hash IS NOT NULL`,
    `CREATE INDEX IF NOT EXISTS idx_files_md5 ON files (md5_hash) WHERE md5_hash IS NOT NULL`,
    `CREATE INDEX IF NOT EXISTS idx_files_user_md5 ON files (user_id, md5_hash) WHERE md5_hash IS NOT NULL`,
    `CREATE INDEX IF NOT EXISTS idx_files_sort_date ON files (user_id, folder_id, created_at DESC) WHERE is_trashed = false`,
    `CREATE INDEX IF NOT EXISTS idx_files_sort_name ON files (user_id, folder_id, file_name ASC) WHERE is_trashed = false`,
    `CREATE INDEX IF NOT EXISTS idx_files_sort_size ON files (user_id, folder_id, file_size DESC) WHERE is_trashed = false`,
    `DELETE FROM files WHERE id IN (SELECT id FROM (SELECT id, ROW_NUMBER() OVER(PARTITION BY user_id, sha256_hash ORDER BY created_at DESC) as row_num FROM files WHERE sha256_hash IS NOT NULL AND is_trashed = false) t WHERE t.row_num > 1)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS files_user_sha256_unique ON files (user_id, sha256_hash) WHERE sha256_hash IS NOT NULL AND is_trashed = false`,
    `CREATE INDEX IF NOT EXISTS idx_share_links_v2_owner_created ON share_links_v2 (owner_user_id, created_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_share_links_v2_slug ON share_links_v2 (slug)`,
    `CREATE INDEX IF NOT EXISTS idx_share_items_v2_share_path ON share_items_v2 (share_id, relative_path)`,
    `CREATE INDEX IF NOT EXISTS idx_share_items_v2_share_pos ON share_items_v2 (share_id, position_index)`,
    `CREATE INDEX IF NOT EXISTS idx_share_access_sessions_v2_share_expires ON share_access_sessions_v2 (share_id, expires_at)`,
    `CREATE INDEX IF NOT EXISTS idx_share_access_sessions_v2_hash ON share_access_sessions_v2 (session_token_hash)`,
    `CREATE INDEX IF NOT EXISTS idx_share_events_v2_share_created ON share_events_v2 (share_id, created_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_share_zip_jobs_v2_share_requested ON share_zip_jobs_v2 (share_id, requested_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_share_zip_jobs_v2_status ON share_zip_jobs_v2 (status)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_tph_file_unique ON telegram_pointer_health (file_id) WHERE file_id IS NOT NULL`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_tph_share_item_unique ON telegram_pointer_health (share_item_id) WHERE share_item_id IS NOT NULL`,
    `CREATE INDEX IF NOT EXISTS idx_tph_user_status_checked ON telegram_pointer_health (user_id, pointer_status, last_checked_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_queue_metrics_created ON telegram_request_queue_metrics (created_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_queue_metrics_session_created ON telegram_request_queue_metrics (session_hash, created_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_segment_manifest_user_status ON file_segment_manifests (user_id, status, updated_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_files_tg_source_tag ON files (user_id, tg_source_tag)`,
    `CREATE INDEX IF NOT EXISTS idx_files_tg_duration ON files (user_id, tg_duration_sec)`,
    `CREATE INDEX IF NOT EXISTS idx_files_tg_size_created ON files (user_id, file_size, created_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_activity_log_user_created ON activity_log(user_id, created_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_file_access_log_file_time ON file_access_log(file_id, accessed_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_file_access_log_user_time ON file_access_log(user_id, accessed_at DESC)`,
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

  const cleanupLegacy = [
    `DROP TRIGGER IF EXISTS trg_validate_shared_link_owner ON shared_links`,
    `DROP FUNCTION IF EXISTS validate_shared_link_owner()`,
    `DROP TABLE IF EXISTS access_logs`,
    `DROP TABLE IF EXISTS shared_files`,
    `DROP TABLE IF EXISTS shared_spaces`,
    `DROP TABLE IF EXISTS shares`,
    `DROP TABLE IF EXISTS shared_links`,
  ];

  try {
    await pool.query(schema);
    console.log('Schema initialized.');

    for (const migration of migrations) {
      try {
        await pool.query(migration);
      } catch (e: any) {
        if (!e.message?.includes('already exists')) {
          console.warn('Migration warning:', e.message);
        }
      }
    }

    for (const stmt of cleanupLegacy) {
      try {
        await pool.query(stmt);
      } catch (e: any) {
        console.warn('Legacy cleanup warning:', e.message);
      }
    }

    console.log('Migrations applied.');
  } catch (error) {
    console.error('Error initializing database schema:', error);
    throw error;
  }
};

export const getDbPool = () => pool;
