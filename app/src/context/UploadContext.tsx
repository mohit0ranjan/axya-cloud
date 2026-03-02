import React, { createContext, useContext, useEffect, useState } from 'react';
import { uploadManager, UploadTask, FileAsset } from '../services/UploadManager';

interface UploadContextType {
    tasks: UploadTask[];
    addUpload: (file: FileAsset | FileAsset[], folderId?: string | null, chatTarget?: string) => void;
    cancelUpload: (id: string) => void;
    cancelAll: () => void;
    pauseUpload: (id: string) => void;
    resumeUpload: (id: string) => void;
    clearCompleted: () => void;
}

const UploadContext = createContext<UploadContextType | undefined>(undefined);

export const UploadProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [tasks, setTasks] = useState<UploadTask[]>([]);

    useEffect(() => {
        // Subscribe to UploadManager state changes
        const unsubscribe = uploadManager.subscribe((newTasks) => {
            setTasks(newTasks);
        });
        return unsubscribe;
    }, []);

    const addUpload = (fileOrFiles: FileAsset | FileAsset[], folderId: string | null = null, chatTarget: string = 'me') => {
        const files = Array.isArray(fileOrFiles) ? fileOrFiles : [fileOrFiles];
        uploadManager.addUploads(files, folderId, chatTarget);
    };

    const cancelUpload = (id: string) => uploadManager.cancel(id);
    const cancelAll = () => uploadManager.cancelAll();
    const pauseUpload = (id: string) => uploadManager.pause(id);
    const resumeUpload = (id: string) => uploadManager.resume(id);
    const clearCompleted = () => uploadManager.clearCompleted();

    return (
        <UploadContext.Provider value={{
            tasks,
            addUpload,
            cancelUpload,
            cancelAll,
            pauseUpload,
            resumeUpload,
            clearCompleted
        }}>
            {children}
        </UploadContext.Provider>
    );
};

export const useUpload = () => {
    const context = useContext(UploadContext);
    if (!context) {
        throw new Error('useUpload must be used within an UploadProvider');
    }
    return context;
};
