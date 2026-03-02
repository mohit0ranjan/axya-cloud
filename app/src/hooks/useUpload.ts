import { useContext, useState } from 'react';
import { UploadProvider, useUpload as useUploadCtx } from '../context/UploadContext';
import { uploadFile, FileAsset } from '../services/uploadService';

export const useUpload = () => {
    const { tasks, addUpload, updateProgress, setComplete, setFailed, cancelUpload: cancelTask } = useUploadCtx();
    const [isProcessing, setIsProcessing] = useState(false);

    const startUpload = async (file: FileAsset, folderId: string | null = null, chatTarget: string = 'me') => {
        const id = Math.random().toString(36).substring(7);
        addUpload(id, file.name, file.size);

        try {
            setIsProcessing(true);
            await uploadFile(
                file,
                folderId,
                chatTarget,
                (progress) => updateProgress(id, Math.round(progress)),
                () => tasks.find(t => t.id === id)?.status === 'cancelled'
            );
            await setComplete(id);
        } catch (e: any) {
            if (e.message === 'Cancelled') {
                cancelTask(id);
            } else {
                setFailed(id, e.message || 'Upload failed');
            }
        } finally {
            setIsProcessing(false);
        }
    };

    return {
        tasks,
        isProcessing,
        startUpload,
        cancelUpload: cancelTask,
    };
};
