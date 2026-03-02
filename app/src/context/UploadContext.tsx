import React, { createContext, useContext, useReducer, useEffect } from 'react';
import * as Notifications from 'expo-notifications';
import { uploadFile, FileAsset } from '../services/uploadService';

export interface UploadTask {
    id: string;
    fileName: string;
    fileSize: number;
    progress: number;
    status: 'pending' | 'uploading' | 'completed' | 'failed' | 'cancelled' | 'queued';
    error?: string;
}

type UploadAction =
    | { type: 'ADD_UPLOAD'; task: UploadTask }
    | { type: 'UPDATE_PROGRESS'; id: string; progress: number }
    | { type: 'SET_STATUS'; id: string; status: UploadTask['status']; error?: string }
    | { type: 'CLEAR_COMPLETED' }
    | { type: 'CANCEL_UPLOAD'; id: string };

interface UploadState {
    tasks: UploadTask[];
}

interface UploadContextType {
    tasks: UploadTask[];
    addUpload: (file: FileAsset, folderId?: string | null, chatTarget?: string) => Promise<void>;
    updateProgress: (id: string, progress: number) => void;
    setComplete: (id: string, fileId?: string) => void;
    setFailed: (id: string, error: string) => void;
    cancelUpload: (id: string) => void;
    clearCompleted: () => void;
}

const UploadContext = createContext<UploadContextType | undefined>(undefined);

const uploadReducer = (state: UploadState, action: UploadAction): UploadState => {
    switch (action.type) {
        case 'ADD_UPLOAD':
            return { ...state, tasks: [...state.tasks, action.task] };
        case 'UPDATE_PROGRESS':
            return {
                ...state,
                tasks: state.tasks.map(t =>
                    t.id === action.id ? { ...t, progress: action.progress, status: 'uploading' } : t
                )
            };
        case 'SET_STATUS':
            return {
                ...state,
                tasks: state.tasks.map(t =>
                    t.id === action.id ? { ...t, status: action.status, error: action.error } : t
                )
            };
        case 'CLEAR_COMPLETED':
            return {
                ...state,
                tasks: state.tasks.filter(t => t.status !== 'completed' && t.status !== 'cancelled')
            };
        case 'CANCEL_UPLOAD':
            return {
                ...state,
                tasks: state.tasks.map(t =>
                    t.id === action.id ? { ...t, status: 'cancelled' } : t
                )
            };
        default:
            return state;
    }
};

export const UploadProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [state, dispatch] = useReducer(uploadReducer, { tasks: [] });

    // Store state in a ref to always have latest value in callbacks
    const currentTasksRef = React.useRef(state.tasks);
    useEffect(() => {
        currentTasksRef.current = state.tasks;
    }, [state.tasks]);

    // Handle Notifications
    useEffect(() => {
        const activeTasks = state.tasks.filter(t => t.status === 'uploading' || t.status === 'queued');
        if (activeTasks.length > 0) {
            const overallProgress = state.tasks.length > 0
                ? Math.round(state.tasks.reduce((acc, t) => acc + t.progress, 0) / state.tasks.length)
                : 0;

            Notifications.setNotificationHandler({
                handleNotification: async () => ({
                    shouldShowAlert: false,
                    shouldPlaySound: false,
                    shouldSetBadge: false,
                    shouldShowBanner: false,
                    shouldShowList: false,
                }),
            });

            Notifications.scheduleNotificationAsync({
                identifier: 'upload_progress',
                content: {
                    title: 'Axya: Uploading Files',
                    body: `${activeTasks.length} file(s) remaining · ${overallProgress}%`,
                    sticky: true,
                    autoDismiss: false,
                } as any,
                trigger: null,
            });
        } else {
            Notifications.dismissNotificationAsync('upload_progress');

            const completed = state.tasks.filter(t => t.status === 'completed').length;
            const failed = state.tasks.filter(t => t.status === 'failed').length;

            if (completed > 0 || failed > 0) {
                Notifications.scheduleNotificationAsync({
                    content: {
                        title: 'Upload Finished',
                        body: `${completed} successful, ${failed} failed.`,
                    },
                    trigger: null,
                });
            }
        }
    }, [state.tasks]);

    const addUpload = async (file: FileAsset, folderId: string | null = null, chatTarget: string = 'me') => {
        const id = Math.random().toString(36).substring(7);
        const task: UploadTask = {
            id,
            fileName: file.name,
            fileSize: file.size,
            progress: 0,
            status: 'queued',
        };

        dispatch({ type: 'ADD_UPLOAD', task });

        try {
            dispatch({ type: 'SET_STATUS', id, status: 'uploading' });
            await uploadFile(
                file,
                folderId,
                chatTarget,
                (progress) => dispatch({ type: 'UPDATE_PROGRESS', id, progress: Math.round(progress) }),
                () => {
                    // Check cancellation status using currentTasksRef
                    const currentTask = currentTasksRef.current.find(t => t.id === id);
                    return currentTask?.status === 'cancelled';
                }
            );
            dispatch({ type: 'SET_STATUS', id, status: 'completed' });
        } catch (e: any) {
            const currentTask = currentTasksRef.current.find(t => t.id === id);
            if (currentTask?.status === 'cancelled' || e.message === 'Cancelled') {
                dispatch({ type: 'SET_STATUS', id, status: 'cancelled' });
            } else {
                dispatch({ type: 'SET_STATUS', id, status: 'failed', error: e.message || 'Unknown error' });
            }
        }
    };

    const updateProgress = (id: string, progress: number) => {
        dispatch({ type: 'UPDATE_PROGRESS', id, progress });
    };

    const setComplete = (id: string) => {
        dispatch({ type: 'SET_STATUS', id, status: 'completed' });
    };

    const setFailed = (id: string, error: string) => {
        dispatch({ type: 'SET_STATUS', id, status: 'failed', error });
    };

    const cancelUpload = (id: string) => {
        dispatch({ type: 'CANCEL_UPLOAD', id });
    };

    const clearCompleted = () => {
        dispatch({ type: 'CLEAR_COMPLETED' });
    };

    return (
        <UploadContext.Provider value={{
            tasks: state.tasks,
            addUpload,
            updateProgress,
            setComplete,
            setFailed,
            cancelUpload,
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
