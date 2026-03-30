import { useApiCacheStore } from '../context/ApiCacheStore';
import { triggerFileRefresh } from '../utils/events';
import { serverReadiness } from './serverReadiness';

type FileLike = {
    id?: string | number;
    created_at?: string;
    updated_at?: string;
    last_accessed_at?: string;
    file_name?: string;
    name?: string;
    file_size?: number;
    size?: number;
    total_file_count?: number;
    file_count?: number;
    folder_count?: number;
    mime_type?: string;
    type?: string;
    is_starred?: boolean;
    is_trashed?: boolean;
    folder_id?: string | null;
};

const toSafeDateString = (value: unknown) => {
    if (!value) return undefined;
    const date = new Date(String(value));
    return Number.isFinite(date.getTime()) ? date.toISOString() : undefined;
};

export type ListSortKey =
    | 'created_at_DESC'
    | 'created_at_ASC'
    | 'updated_at_DESC'
    | 'updated_at_ASC'
    | 'last_accessed_at_DESC'
    | 'last_accessed_at_ASC'
    | 'file_name_ASC'
    | 'file_name_DESC'
    | 'file_size_ASC'
    | 'file_size_DESC';

const toSafeTimestamp = (...values: Array<string | number | Date | null | undefined>) => {
    for (const value of values) {
        if (!value) continue;
        const time = new Date(value).getTime();
        if (Number.isFinite(time)) return time;
    }
    return 0;
};

const toSafeNumber = (value: unknown) => {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
};

export const getItemName = <T extends FileLike>(item: T) => {
    return String(item?.file_name || item?.name || '').trim();
};

export const getItemSize = <T extends FileLike>(item: T) => {
    return toSafeNumber(item?.size ?? item?.file_size ?? 0);
};

export const getFolderFileCount = <T extends FileLike>(item: T) => {
    const directFiles = toSafeNumber(item?.file_count ?? 0);
    const totalFiles = toSafeNumber(item?.total_file_count ?? directFiles);
    return Math.max(directFiles, totalFiles);
};

export const getFolderSubfolderCount = <T extends FileLike>(item: T) => {
    return Math.max(0, Math.floor(toSafeNumber(item?.folder_count ?? 0)));
};

export const sortItems = <T extends FileLike>(items: T[], sortKey: ListSortKey = 'created_at_DESC'): T[] => {
    const sortDirection = sortKey.endsWith('_ASC') ? 1 : -1;

    return [...(items || [])].sort((a, b) => {
        if (sortKey.startsWith('file_name')) {
            const nameA = getItemName(a).toLowerCase();
            const nameB = getItemName(b).toLowerCase();
            const cmp = nameA.localeCompare(nameB);
            if (cmp !== 0) return cmp * sortDirection;
        }

        if (sortKey.startsWith('file_size')) {
            const cmp = getItemSize(a) - getItemSize(b);
            if (cmp !== 0) return cmp * sortDirection;
        }

        const timeA = sortKey.startsWith('updated_at')
            ? toSafeTimestamp(a?.updated_at, a?.created_at)
            : sortKey.startsWith('last_accessed_at')
                ? toSafeTimestamp(a?.last_accessed_at, a?.updated_at, a?.created_at)
                : toSafeTimestamp(a?.created_at, a?.updated_at);
        const timeB = sortKey.startsWith('updated_at')
            ? toSafeTimestamp(b?.updated_at, b?.created_at)
            : sortKey.startsWith('last_accessed_at')
                ? toSafeTimestamp(b?.last_accessed_at, b?.updated_at, b?.created_at)
                : toSafeTimestamp(b?.created_at, b?.updated_at);
        const timeCmp = timeA - timeB;
        if (timeCmp !== 0) return timeCmp * sortDirection;

        return getItemName(a).toLowerCase().localeCompare(getItemName(b).toLowerCase());
    });
};

export const dedupeFilesById = <T extends FileLike>(items: T[]): T[] => {
    const seen = new Map<string, T>();
    for (const item of items || []) {
        const id = String(item?.id ?? '');
        if (!id) continue;
        const existing = seen.get(id);
        if (!existing) {
            seen.set(id, item);
            continue;
        }
        const existingTs = toSafeTimestamp(existing?.updated_at, existing?.created_at);
        const incomingTs = toSafeTimestamp(item?.updated_at, item?.created_at);
        if (incomingTs >= existingTs) {
            seen.set(id, { ...existing, ...item });
        }
    }
    return Array.from(seen.values());
};

export const normalizeFile = <T extends FileLike>(item: T): T => {
    const id = item?.id == null ? undefined : String(item.id);
    const normalizedName = getItemName(item) || 'Untitled';
    const normalizedSize = getItemSize(item);
    const createdAt = toSafeDateString(item?.created_at) || toSafeDateString(item?.updated_at);
    const updatedAt = toSafeDateString(item?.updated_at) || createdAt;
    const lastAccessedAt = toSafeDateString(item?.last_accessed_at);
    const normalizedMime = String(item?.mime_type || '').trim() || (String(item?.type || '').trim() || undefined);

    return {
        ...item,
        ...(id ? { id } : {}),
        name: normalizedName,
        file_name: normalizedName,
        size: normalizedSize,
        file_size: normalizedSize,
        mime_type: normalizedMime,
        created_at: createdAt,
        updated_at: updatedAt,
        last_accessed_at: lastAccessedAt,
        is_starred: Boolean(item?.is_starred),
        is_trashed: Boolean(item?.is_trashed),
        folder_id: item?.folder_id ?? null,
    } as T;
};

export const sortFilesLatestFirst = <T extends FileLike>(items: T[]): T[] => {
    return sortItems(items, 'created_at_DESC');
};

export const sortFilesRecentFirst = <T extends FileLike>(items: T[]): T[] => {
    return sortItems(items, 'last_accessed_at_DESC');
};

export const normalizeItems = <T extends FileLike>(items: T[], sortKey: ListSortKey = 'created_at_DESC') => {
    return sortItems(dedupeFilesById((items || []).map((item) => normalizeFile(item))), sortKey);
};

let deferredRefreshPending = false;

export const syncAfterFileMutation = (options?: { clearCache?: boolean }) => {
    if (options?.clearCache !== false) {
        useApiCacheStore.getState().clearCache();
    }

    if (serverReadiness.isWakeInProgress()) {
        if (deferredRefreshPending) return;
        deferredRefreshPending = true;
        serverReadiness.runWhenReady(() => {
            deferredRefreshPending = false;
            triggerFileRefresh();
        });
        return;
    }

    triggerFileRefresh();
};
