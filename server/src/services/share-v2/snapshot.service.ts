import { PoolClient } from 'pg';

export const rebuildShareSnapshot = async (
    client: PoolClient,
    shareId: string,
    ownerUserId: string,
    resourceType: 'file' | 'folder',
    rootFileId: string | null,
    rootFolderId: string | null,
) => {
    await client.query('DELETE FROM share_items_v2 WHERE share_id = $1', [shareId]);

    if (resourceType === 'file') {
        if (!rootFileId) {
            throw new Error('root_file_id is required for file shares');
        }

        const inserted = await client.query(
            `INSERT INTO share_items_v2 (
                share_id, file_id, relative_path, display_name, mime_type, size_bytes,
                telegram_chat_id, telegram_message_id, telegram_file_id, position_index
            )
            SELECT
                $1,
                f.id,
                ''::text AS relative_path,
                f.file_name,
                f.mime_type,
                COALESCE(f.file_size, 0),
                COALESCE(NULLIF(f.telegram_chat_id, ''), 'me'),
                f.telegram_message_id,
                f.telegram_file_id,
                0
            FROM files f
            WHERE f.id = $2 AND f.user_id = $3 AND f.is_trashed = false
              AND f.telegram_message_id IS NOT NULL
            RETURNING id`,
            [shareId, rootFileId, ownerUserId]
        );

        if (inserted.rowCount === 0) {
            throw new Error('Root file unavailable for share snapshot');
        }
        return;
    }

    if (!rootFolderId) {
        throw new Error('root_folder_id is required for folder shares');
    }

    const inserted = await client.query(
        `WITH RECURSIVE folder_tree AS (
            SELECT id, parent_id, ''::text AS relative_path
            FROM folders
            WHERE id = $1 AND user_id = $2 AND is_trashed = false
            UNION ALL
            SELECT f.id, f.parent_id,
                   CASE WHEN ft.relative_path = '' THEN f.name ELSE ft.relative_path || '/' || f.name END
            FROM folders f
            JOIN folder_tree ft ON f.parent_id = ft.id
            WHERE f.user_id = $2 AND f.is_trashed = false
        ), file_rows AS (
            SELECT
                f.id AS file_id,
                ft.relative_path,
                f.file_name,
                f.mime_type,
                COALESCE(f.file_size, 0) AS file_size,
                COALESCE(NULLIF(f.telegram_chat_id, ''), 'me') AS telegram_chat_id,
                f.telegram_message_id,
                f.telegram_file_id,
                ROW_NUMBER() OVER (ORDER BY ft.relative_path ASC, f.file_name ASC, f.id ASC) - 1 AS position_index
            FROM files f
            JOIN folder_tree ft ON ft.id = f.folder_id
            WHERE f.user_id = $2
              AND f.is_trashed = false
              AND f.telegram_message_id IS NOT NULL
        )
        INSERT INTO share_items_v2 (
            share_id, file_id, relative_path, display_name, mime_type, size_bytes,
            telegram_chat_id, telegram_message_id, telegram_file_id, position_index
        )
        SELECT
            $3,
            fr.file_id,
            fr.relative_path,
            fr.file_name,
            fr.mime_type,
            fr.file_size,
            fr.telegram_chat_id,
            fr.telegram_message_id,
            fr.telegram_file_id,
            fr.position_index
        FROM file_rows fr
        RETURNING id`,
        [rootFolderId, ownerUserId, shareId]
    );

    if (inserted.rowCount === 0) {
        // Allow empty folder snapshots; callers can still share folder metadata.
        return;
    }
};
