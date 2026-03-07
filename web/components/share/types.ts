export type ShareMeta = {
    id: string;
    slug: string;
    resourceType: 'file' | 'folder';
    allowDownload: boolean;
    allowPreview: boolean;
    requiresPassword: boolean;
    expiresAt: string | null;
    revokedAt: string | null;
    fileCount: number;
};

export type SharedFolder = {
    name: string;
    path: string;
    fileCount: number;
};

export type SharedFile = {
    id: string;
    display_name: string;
    size_bytes: number;
    mime_type: string | null;
    relative_path: string;
    created_at: string;
};

export type SectionData = {
    path: string;
    folders: SharedFolder[];
    files: SharedFile[];
    page: {
        offset: number;
        limit: number;
        total: number;
        hasMore: boolean;
    };
    cursor?: {
        next: string | null;
        current: string;
    };
};

export type SectionState = SectionData & {
    expanded: boolean;
    loading: boolean;
    error: string;
};

export type ImageModalState = {
    open: boolean;
    items: SharedFile[];
    index: number;
};
