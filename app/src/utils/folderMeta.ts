type FolderMetaLike = {
    file_count?: number | null;
    total_file_count?: number | null;
    folder_count?: number | null;
};

const toSafeCount = (value: unknown): number => {
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0) return 0;
    return Math.floor(n);
};

export const formatFolderMeta = (item: FolderMetaLike): string => {
    const directFiles = toSafeCount(item.file_count ?? 0);
    const totalFiles = Math.max(directFiles, toSafeCount(item.total_file_count ?? directFiles));
    const subfolders = toSafeCount(item.folder_count ?? 0);

    if (totalFiles > 0 && subfolders > 0) {
        return `${totalFiles} file${totalFiles === 1 ? '' : 's'} · ${subfolders} subfolder${subfolders === 1 ? '' : 's'}`;
    }
    if (subfolders > 0) {
        return `${subfolders} subfolder${subfolders === 1 ? '' : 's'}`;
    }
    if (totalFiles > 0) {
        return `${totalFiles} file${totalFiles === 1 ? '' : 's'}`;
    }
    return 'Empty folder';
};

