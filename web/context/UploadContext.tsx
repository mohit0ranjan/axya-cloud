'use client';

import React, { createContext, useContext, ReactNode } from 'react';
import { useProductionUpload } from '../hooks/useProductionUpload';
import { UploadTask, UploadStats, UploadQueueConfig } from '@/lib/upload/production-types';

interface UploadContextType {
  tasks: UploadTask[];
  stats: UploadStats;
  addFiles: (files: File[], options?: any) => UploadTask[];
  pauseTask: (taskId: string) => boolean;
  resumeTask: (taskId: string) => boolean;
  cancelTask: (taskId: string) => Promise<boolean>;
  retryTask: (taskId: string) => boolean;
  clearCompleted: () => void;
}

const UploadContext = createContext<UploadContextType | undefined>(undefined);

interface UploadProviderProps {
  children: ReactNode;
  config?: Partial<UploadQueueConfig>;
}

export function UploadProvider({ children, config }: UploadProviderProps) {
  const {
    tasks,
    stats,
    addFiles,
    pauseTask,
    resumeTask,
    cancelTask,
    retryTask,
    clearCompleted,
  } = useProductionUpload(config);

  return (
    <UploadContext.Provider
      value={{
        tasks,
        stats,
        addFiles,
        pauseTask,
        resumeTask,
        cancelTask,
        retryTask,
        clearCompleted,
      }}
    >
      {children}
    </UploadContext.Provider>
  );
}

export function useUpload(): UploadContextType {
  const context = useContext(UploadContext);
  if (!context) {
    throw new Error('useUpload must be used within UploadProvider');
  }
  return context;
}
