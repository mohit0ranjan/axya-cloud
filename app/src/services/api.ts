import apiClient from './apiClient';

export interface ShareOptions {
    file_id?: string;
    folder_id?: string;
    expires_in_hours?: number;
    allow_download?: boolean;
    allow_preview?: boolean;
    password?: string;
}

export interface SharePatchOptions {
    allow_download?: boolean;
    allow_preview?: boolean;
    password?: string;
    expires_at?: string | null;
    revoke?: boolean;
}

export const createShareLink = async (options: ShareOptions) => {
    const fileId = String(options.file_id || '').trim();
    const folderId = String(options.folder_id || '').trim();
    if (!fileId && !folderId) throw new Error('Must provide file_id or folder_id');
    if (fileId && folderId) throw new Error('Provide either file_id or folder_id, not both');

    const expiresAt = Number.isFinite(Number(options.expires_in_hours)) && Number(options.expires_in_hours) > 0
        ? new Date(Date.now() + Number(options.expires_in_hours) * 60 * 60 * 1000).toISOString()
        : null;

    const payload: Record<string, unknown> = {
        resource_type: fileId ? 'file' : 'folder',
        root_file_id: fileId || undefined,
        root_folder_id: folderId || undefined,
        allow_download: options.allow_download !== false,
        allow_preview: options.allow_preview !== false,
        expires_at: expiresAt,
    };

    const normalizedPassword = String(options.password || '').trim();
    if (normalizedPassword) payload.password = normalizedPassword;

    const { data } = await apiClient.post('/api/v2/shares', payload);
    return data;
};

export const revokeShareLink = async (id: string) => {
    const { data } = await apiClient.delete(`/api/v2/shares/${id}`);
    return data;
};

export const fetchShareDetails = async (id: string) => {
    const { data } = await apiClient.get(`/api/v2/shares/${id}`);
    return data;
};

export const updateShareLink = async (id: string, updates: SharePatchOptions) => {
    const { data } = await apiClient.patch(`/api/v2/shares/${id}`, updates);
    return data;
};
