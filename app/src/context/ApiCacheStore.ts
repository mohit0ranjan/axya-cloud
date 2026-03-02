import { create } from 'zustand';

interface ApiCacheState {
    homeData: { stats: any; files: any[]; folders: any[]; recent: any[]; activity: any[] } | null;
    allFiles: any[] | null;
    starredFiles: any[] | null;
    foldersList: any[] | null;

    setHomeData: (data: any) => void;
    setAllFiles: (files: any[]) => void;
    setStarredFiles: (files: any[]) => void;
    setFoldersList: (folders: any[]) => void;
    clearCache: () => void;
}

export const useApiCacheStore = create<ApiCacheState>((set) => ({
    homeData: null,
    allFiles: null,
    starredFiles: null,
    foldersList: null,

    setHomeData: (data) => set({ homeData: data }),
    setAllFiles: (files) => set({ allFiles: files }),
    setStarredFiles: (files) => set({ starredFiles: files }),
    setFoldersList: (folders) => set({ foldersList: folders }),
    clearCache: () => set({ homeData: null, allFiles: null, starredFiles: null, foldersList: null })
}));
