import apiClient from './apiClient';

export interface SharedSpaceDto {
    id: string;
    name: string;
    allow_upload: boolean;
    allow_download: boolean;
    expires_at: string | null;
    created_at: string;
    requires_password?: boolean;
    has_access?: boolean;
}

export interface SharedSpaceFileDto {
    id: string;
    file_name: string;
    file_size: number;
    mime_type: string | null;
    folder_path: string;
    created_at: string;
    download_url: string | null;
}

export interface SharedSpaceFolderDto {
    name: string;
    path: string;
}

const withAccessHeader = (accessToken?: string) => {
    return accessToken ? { headers: { 'x-space-access-token': accessToken } } : undefined;
};

export const fetchSharedSpace = async (spaceId: string, accessToken?: string): Promise<SharedSpaceDto> => {
    const res = await apiClient.get(`/api/spaces/${spaceId}`, withAccessHeader(accessToken));
    if (!res.data?.success) throw new Error(res.data?.error || 'Failed to load shared space');
    return res.data.space as SharedSpaceDto;
};

export const validateSharedSpacePassword = async (spaceId: string, password: string): Promise<string> => {
    const res = await apiClient.post(`/api/spaces/${spaceId}/validate-password`, { password });
    if (!res.data?.success) throw new Error(res.data?.error || 'Invalid password');
    return String(res.data.access_token || '');
};

export const fetchSharedSpaceFiles = async (spaceId: string, folderPath: string, accessToken?: string) => {
    const res = await apiClient.get('/api/spaces/' + encodeURIComponent(spaceId) + '/files', {
        params: { folder_path: folderPath },
        ...(accessToken ? { headers: { 'x-space-access-token': accessToken } } : {}),
    });
    if (!res.data?.success) throw new Error(res.data?.error || 'Failed to load files');
    return {
        space: res.data.space as SharedSpaceDto,
        files: (res.data.files || []) as SharedSpaceFileDto[],
        folders: (res.data.folders || []) as SharedSpaceFolderDto[],
    };
};

export const uploadSharedSpaceFile = async (
    spaceId: string,
    file: { uri: string; name: string; mimeType?: string | null },
    folderPath: string,
    accessToken?: string
) => {
    const form = new FormData();
    form.append('folder_path', folderPath);
    form.append('file', {
        uri: file.uri,
        name: file.name,
        type: file.mimeType || 'application/octet-stream',
    } as any);

    const res = await apiClient.post(`/api/spaces/${spaceId}/upload`, form, {
        headers: {
            'Content-Type': 'multipart/form-data',
            ...(accessToken ? { 'x-space-access-token': accessToken } : {}),
        },
    });
    if (!res.data?.success) throw new Error(res.data?.error || 'Upload failed');
    return res.data.file as SharedSpaceFileDto;
};
