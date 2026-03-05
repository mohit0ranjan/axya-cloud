import apiClient from './apiClient';

export interface ShareOptions {
    file_id?: string;
    folder_id?: string;
    expires_in_hours?: number;
    password?: string;
    allow_download?: boolean;
    view_only?: boolean;
}

export const createShareLink = async (options: ShareOptions) => {
    if (!options.file_id && !options.folder_id) throw new Error("Must provide file_id or folder_id");

    const { data } = await apiClient.post('/share', options);
    return data;
};

export const revokeShareLink = async (id: string) => {
    const { data } = await apiClient.delete(`/share/${id}`);
    return data;
};
