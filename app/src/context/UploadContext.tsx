/**
 * UploadContext.tsx
 *
 * Global React context that wraps the singleton UploadManager.
 * Re-renders only when the uploadManager emits new task snapshots.
 */

import React, { createContext, useContext, useEffect, useState } from 'react';
import { uploadManager, UploadTask, FileAsset } from '../services/UploadManager';

interface UploadContextType {
    tasks: UploadTask[];
    /** Add one or more files to the upload queue */
    addUpload: (
        file: FileAsset | FileAsset[],
        folderId?: string | null,
        chatTarget?: string
    ) => void;
    cancelUpload: (id: string) => void;
    cancelAll: () => void;
    pauseUpload: (id: string) => void;
    resumeUpload: (id: string) => void;
    clearCompleted: () => void;
    retryFailed: () => void;
    /** Derived helpers */
    activeCount: number;
    overallProgress: number;
}

const UploadContext = createContext<UploadContextType | undefined>(undefined);

export const UploadProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [tasks, setTasks] = useState<UploadTask[]>([]);

    useEffect(() => {
        // Subscribe to UploadManager — new array + new object references on every notify
        const unsubscribe = uploadManager.subscribe(newTasks => {
            setTasks(newTasks);
        });
        return unsubscribe;
    }, []);

    // ── Actions ───────────────────────────────────────────────────────────────

    const addUpload = (
        fileOrFiles: FileAsset | FileAsset[],
        folderId: string | null = null,
        chatTarget: string = 'me'
    ) => {
        const files = Array.isArray(fileOrFiles) ? fileOrFiles : [fileOrFiles];
        uploadManager.addUploads(files, folderId, chatTarget);
    };

    const cancelUpload = (id: string) => uploadManager.cancel(id);
    const cancelAll = () => uploadManager.cancelAll();
    const pauseUpload = (id: string) => uploadManager.pause(id);
    const resumeUpload = (id: string) => uploadManager.resume(id);
    const clearCompleted = () => uploadManager.clearCompleted();
    const retryFailed = () => uploadManager.retryFailed();

    // ── Derived helpers ───────────────────────────────────────────────────────

    const activeCount = tasks.filter(
        t => t.status === 'uploading' || t.status === 'queued' || t.status === 'retrying'
    ).length;

    const activeTasks = tasks.filter(
        t => t.status === 'uploading' || t.status === 'queued' || t.status === 'retrying'
    );
    const totalWeight = activeTasks.reduce((acc, t) => acc + Math.max(t.file.size || 1, 1), 0);
    const weightedProgress = activeTasks.reduce(
        (acc, t) => acc + (Math.max(t.file.size || 1, 1) * Math.max(0, Math.min(100, t.progress))),
        0
    );
    const overallProgress =
        activeTasks.length > 0
            ? Math.round(weightedProgress / totalWeight)
            : tasks.every(t => t.status === 'completed') && tasks.length > 0
                ? 100
                : 0;

    return (
        <UploadContext.Provider
            value={{
                tasks,
                addUpload,
                cancelUpload,
                cancelAll,
                pauseUpload,
                resumeUpload,
                clearCompleted,
                retryFailed,
                activeCount,
                overallProgress,
            }}
        >
            {children}
        </UploadContext.Provider>
    );
};

export const useUpload = (): UploadContextType => {
    const context = useContext(UploadContext);
    if (!context) {
        throw new Error('useUpload must be used within an UploadProvider');
    }
    return context;
};
