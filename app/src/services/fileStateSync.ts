import { useApiCacheStore } from '../context/ApiCacheStore';
import { triggerFileRefresh } from '../utils/events';

type FileLike = { id?: string | number; created_at?: string };

export const dedupeFilesById = <T extends FileLike>(items: T[]): T[] => {
    const seen = new Set<string>();
    const out: T[] = [];
    for (const item of items || []) {
        const id = String(item?.id ?? '');
        if (!id || seen.has(id)) continue;
        seen.add(id);
        out.push(item);
    }
    return out;
};

export const sortFilesLatestFirst = <T extends FileLike>(items: T[]): T[] => {
    return [...(items || [])].sort((a, b) => {
        const aTs = new Date(a?.created_at || 0).getTime();
        const bTs = new Date(b?.created_at || 0).getTime();
        return bTs - aTs;
    });
};

export const syncAfterFileMutation = (options?: { clearCache?: boolean }) => {
    if (options?.clearCache !== false) {
        useApiCacheStore.getState().clearCache();
    }
    triggerFileRefresh();
};
