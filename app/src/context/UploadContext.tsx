/**
 * UploadContext.tsx
 *
 * Global React context that wraps the singleton UploadManager.
 * Re-renders only when the uploadManager emits new task snapshots.
 *
 * ✅ Exposes all aggregate stats (totalFiles, totalBytes, uploadedBytes, etc.)
 * ✅ Byte-accurate overallProgress = uploadedBytes / totalBytes * 100
 * ✅ All actions: add, cancel, cancelAll, pause, resume, retry, clear
 */

import React, { createContext, useContext, useEffect, useState, useMemo } from 'react';
import { uploadManager, UploadTask, FileAsset } from '../services/UploadManager';

interface UploadStats {
    totalFiles: number;
    uploadedCount: number;
    queuedCount: number;
    failedCount: number;
    activeCount: number;
    uploadingCount: number;
    pausedCount: number;
    cancelledCount: number;
    totalBytes: number;
    uploadedBytes: number;
    /** 0-100, byte-accurate */
    overallProgress: number;
}

interface UploadContextType extends UploadStats {
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

    // ── Derived aggregate stats ──────────────────────────────────────────────
    // Computed from tasks snapshot so they stay in sync with React state

    const stats: UploadStats = useMemo(() => {
        const totalFiles = tasks.length;
        const uploadedCount = tasks.filter(t => t.status === 'completed').length;
        const queuedCount = tasks.filter(t => t.status === 'queued').length;
        const failedCount = tasks.filter(t => t.status === 'failed').length;
        const activeCount = tasks.filter(
            t => t.status === 'uploading' || t.status === 'queued' || t.status === 'retrying'
        ).length;
        const uploadingCount = tasks.filter(t => t.status === 'uploading').length;
        const pausedCount = tasks.filter(t => t.status === 'paused').length;
        const cancelledCount = tasks.filter(t => t.status === 'cancelled').length;

        const totalBytes = tasks.reduce((acc, t) => acc + Math.max(t.file.size || 1, 1), 0);
        const uploadedBytes = tasks.reduce((acc, t) => {
            if (t.status === 'completed') return acc + Math.max(t.file.size || 1, 1);
            return acc + (t.bytesUploaded || 0);
        }, 0);

        const overallProgress = totalBytes > 0
            ? Math.round(Math.min((uploadedBytes / totalBytes) * 100, 100))
            : 0;

        return {
            totalFiles,
            uploadedCount,
            queuedCount,
            failedCount,
            activeCount,
            uploadingCount,
            pausedCount,
            cancelledCount,
            totalBytes,
            uploadedBytes,
            overallProgress,
        };
    }, [tasks]);

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
                ...stats,
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
