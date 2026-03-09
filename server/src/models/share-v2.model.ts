export type ShareResourceType = 'file' | 'folder';

export type ShareEventType = 'open' | 'preview' | 'download' | 'download_zip' | 'error';

export interface ShareLinkV2Row {
    id: string;
    owner_user_id: string;
    resource_type: ShareResourceType;
    root_file_id: string | null;
    root_folder_id: string | null;
    slug: string;
    link_secret_hash: string;
    password_hash: string | null;
    allow_download: boolean;
    allow_preview: boolean;
    expires_at: string | Date | null;
    revoked_at: string | Date | null;
    created_at: string | Date;
    updated_at: string | Date;
}

export interface ShareItemV2Row {
    id: string;
    share_id: string;
    file_id: string;
    relative_path: string;
    display_name: string;
    mime_type: string | null;
    size_bytes: number;
    telegram_chat_id: string;
    telegram_message_id: string | number;
    telegram_file_id: string | null;
    position_index: number;
    pointer_health?: 'healthy' | 'stale' | 'missing' | 'recovered' | null;
    cache_state?: 'hot' | 'warm' | 'miss';
    segment_mode_enabled?: boolean;
    created_at: string | Date;
}

export interface ShareAccessSessionV2Row {
    id: string;
    share_id: string;
    session_token_hash: string;
    granted_at: string | Date;
    expires_at: string | Date;
    ip: string | null;
    user_agent: string | null;
    revoked_at: string | Date | null;
}

export interface ShareItemsListResult {
    path: string;
    folders: Array<{ name: string; path: string; fileCount: number }>;
    files: ShareItemV2Row[];
    page: {
        offset: number;
        limit: number;
        total: number;
        hasMore: boolean;
    };
}

export interface ShareMetaV2 {
    id: string;
    slug: string;
    resourceType: ShareResourceType;
    allowDownload: boolean;
    allowPreview: boolean;
    requiresPassword: boolean;
    expiresAt: string | Date | null;
    revokedAt: string | Date | null;
    fileCount: number;
}
