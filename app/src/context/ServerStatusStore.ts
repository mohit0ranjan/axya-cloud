import { create } from 'zustand';

interface ServerStatusState {
    isWaking: boolean;
    setIsWaking: (waking: boolean) => void;
}

export const useServerStatusStore = create<ServerStatusState>((set) => ({
    isWaking: false,
    setIsWaking: (waking) => set({ isWaking: waking }),
}));
