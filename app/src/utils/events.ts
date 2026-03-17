import { DeviceEventEmitter } from 'react-native';
import { useEffect } from 'react';

export const FILE_REFRESH_EVENT = 'EVENT_FILE_REFRESH';
export const FILE_DELETED_EVENT = 'EVENT_FILE_DELETED';
export const FILE_ADDED_EVENT = 'EVENT_FILE_ADDED';
export const FILE_UPDATED_EVENT = 'EVENT_FILE_UPDATED';

/**
 * Triggers a global file refresh event.
 * Call this after successful upload, delete, rename, move, etc.
 */
export const triggerFileRefresh = () => {
    DeviceEventEmitter.emit(FILE_REFRESH_EVENT);
};

export const emitFileDeleted = (id: string | string[]) => {
    const ids = Array.isArray(id) ? id : [id];
    ids.forEach(i => DeviceEventEmitter.emit(FILE_DELETED_EVENT, i));
};

export const emitFileAdded = (file: any) => {
    DeviceEventEmitter.emit(FILE_ADDED_EVENT, file);
};

export const emitFileUpdated = (id: string | string[], updates: any) => {
    const ids = Array.isArray(id) ? id : [id];
    ids.forEach(i => DeviceEventEmitter.emit(FILE_UPDATED_EVENT, { id: i, updates }));
};

/**
 * React hook to auto-refresh data when a file operation occurs elsewhere.
 * @param callback The function to call when a refresh is triggered.
 */
export const useFileRefresh = (callback: () => void) => {
    const savedCallback = require('react').useRef(callback);

    require('react').useEffect(() => {
        savedCallback.current = callback;
    });

    require('react').useEffect(() => {
        const subscription = DeviceEventEmitter.addListener(FILE_REFRESH_EVENT, () => {
            savedCallback.current?.();
        });
        return () => subscription.remove();
    }, []);
};

/**
 * React hook to optimistically update a local files array immediately.
 */
export const useOptimisticFiles = (setFiles: (updater: (prev: any[]) => any[]) => void) => {
    require('react').useEffect(() => {
        const sub1 = DeviceEventEmitter.addListener(FILE_DELETED_EVENT, (id: string) => {
            setFiles((prev) => prev.filter((f) => f.id !== id));
        });
        const sub2 = DeviceEventEmitter.addListener(FILE_ADDED_EVENT, (file: any) => {
            setFiles((prev) => {
                if (prev.find(f => f.id === file.id)) return prev;
                return [file, ...prev];
            });
        });
        const sub3 = DeviceEventEmitter.addListener(FILE_UPDATED_EVENT, ({ id, updates }: { id: string, updates: any }) => {
            setFiles((prev) => prev.map((f) => (f.id === id ? { ...f, ...updates } : f)));
        });
        return () => {
            sub1.remove();
            sub2.remove();
            sub3.remove();
        };
    }, [setFiles]);
};
