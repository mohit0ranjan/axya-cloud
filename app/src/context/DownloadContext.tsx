/**
 * DownloadContext.tsx
 *
 * Global React context wrapping the singleton DownloadManager.
 * Re-renders only when the downloadManager emits new task snapshots.
 */

import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { downloadManager, DownloadTask } from '../services/DownloadManager';

interface DownloadContextType {
    tasks: DownloadTask[];
    /** Queue a single file download */
    addDownload: (fileId: string, fileName: string, jwt: string, mimeType?: string) => string;
    /** Cancel a single download */
    cancelDownload: (id: string) => void;
    /** Cancel ALL active/queued downloads */
    cancelAll: () => void;
    /** Remove completed/cancelled/failed from the list */
    clearCompleted: () => void;
    /** Derived helpers */
    activeCount: number;
    overallProgress: number;
    hasActive: boolean;
}

const DownloadContext = createContext<DownloadContextType | undefined>(undefined);

export const DownloadProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [tasks, setTasks] = useState<DownloadTask[]>([]);

    useEffect(() => {
        const unsubscribe = downloadManager.subscribe(newTasks => {
            setTasks(newTasks);
        });
        return unsubscribe;
    }, []);

    // ── Actions ──────────────────────────────────────────────────────────────

    const addDownload = useCallback(
        (fileId: string, fileName: string, jwt: string, mimeType?: string) =>
            downloadManager.addDownload(fileId, fileName, jwt, mimeType),
        [],
    );

    const cancelDownload = useCallback((id: string) => downloadManager.cancel(id), []);
    const cancelAll = useCallback(() => downloadManager.cancelAll(), []);
    const clearCompleted = useCallback(() => downloadManager.clearCompleted(), []);

    // ── Derived helpers ──────────────────────────────────────────────────────

    const activeCount = tasks.filter(
        t => t.status === 'downloading' || t.status === 'queued'
    ).length;

    const activeTasks = tasks.filter(
        t => t.status === 'downloading' || t.status === 'queued'
    );
    const overallProgress =
        activeTasks.length > 0
            ? Math.round(activeTasks.reduce((acc, t) => acc + t.progress, 0) / activeTasks.length)
            : tasks.every(t => t.status === 'completed') && tasks.length > 0
                ? 100
                : 0;

    const hasActive = activeTasks.length > 0;

    return (
        <DownloadContext.Provider
            value={{
                tasks,
                addDownload,
                cancelDownload,
                cancelAll,
                clearCompleted,
                activeCount,
                overallProgress,
                hasActive,
            }}
        >
            {children}
        </DownloadContext.Provider>
    );
};

export const useDownload = (): DownloadContextType => {
    const context = useContext(DownloadContext);
    if (!context) {
        throw new Error('useDownload must be used within a DownloadProvider');
    }
    return context;
};
