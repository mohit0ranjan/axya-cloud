import { useCallback, useEffect, useState } from 'react';
import {
  ProductionUploadManager,
  getUploadManager,
} from '../upload/productionUploadManager';
import { UploadTask, UploadStats, UploadQueueConfig } from '../upload/production-types';

export function useProductionUpload(config?: Partial<UploadQueueConfig>) {
  const [tasks, setTasks] = useState<UploadTask[]>([]);
  const [stats, setStats] = useState<UploadStats>({
    totalFiles: 0,
    totalBytes: 0,
    queued: 0,
    uploading: 0,
    paused: 0,
    completed: 0,
    failed: 0,
    cancelled: 0,
    uploadedBytes: 0,
    uploadedFiles: 0,
    avgSpeed: 0,
    overallProgress: 0,
  });

  const manager = getUploadManager(config);

  // Update UI when tasks or stats change
  const handleTaskUpdate = useCallback(() => {
    setTasks([...manager.getTasks()]);
  }, [manager]);

  const handleStatsUpdate = useCallback((newStats: UploadStats) => {
    setStats(newStats);
  }, []);

  useEffect(() => {
    manager.on({
      onTaskUpdate: handleTaskUpdate,
      onStatsUpdate: handleStatsUpdate,
      onQueueChange: handleTaskUpdate,
    });

    // Initial state
    setTasks([...manager.getTasks()]);
    setStats(manager.getStats());
  }, [manager, handleTaskUpdate, handleStatsUpdate]);

  const addFiles = useCallback(
    (files: File[], options?: { folderId?: number; telegramChatId?: string }) => {
      return manager.addFiles(files, options);
    },
    [manager]
  );

  const pauseTask = useCallback(
    (taskId: string) => {
      const result = manager.pauseTask(taskId);
      if (result) setTasks([...manager.getTasks()]);
      return result;
    },
    [manager]
  );

  const resumeTask = useCallback(
    (taskId: string) => {
      const result = manager.resumeTask(taskId);
      if (result) setTasks([...manager.getTasks()]);
      return result;
    },
    [manager]
  );

  const cancelTask = useCallback(
    async (taskId: string) => {
      const result = await manager.cancelTask(taskId);
      if (result) setTasks([...manager.getTasks()]);
      return result;
    },
    [manager]
  );

  const retryTask = useCallback(
    (taskId: string) => {
      const result = manager.retryTask(taskId);
      if (result) setTasks([...manager.getTasks()]);
      return result;
    },
    [manager]
  );

  const clearCompleted = useCallback(() => {
    manager.clearCompleted();
    setTasks([...manager.getTasks()]);
  }, [manager]);

  return {
    tasks,
    stats,
    addFiles,
    pauseTask,
    resumeTask,
    cancelTask,
    retryTask,
    clearCompleted,
    manager,
  };
}
