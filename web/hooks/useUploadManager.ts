"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { UploadEngine } from '../lib/upload/uploadEngine';
import type { UploadStats, UploadTask } from '../lib/upload/types';

const makeId = () => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `u_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
};

const initialStats: UploadStats = {
  uploading: 0,
  queued: 0,
  failed: 0,
  paused: 0,
  completed: 0,
  avgSpeed: 0,
};

export function useUploadManager() {
  const [tasks, setTasks] = useState<UploadTask[]>([]);
  const engineRef = useRef<UploadEngine | null>(null);

  useEffect(() => {
    let pendingPatches = new Map<string, Partial<UploadTask>>();
    let patchTimeout: ReturnType<typeof setTimeout> | null = null;

    engineRef.current = new UploadEngine({
      onPatch(taskId, patch) {
        const existing = pendingPatches.get(taskId) || {};
        pendingPatches.set(taskId, { ...existing, ...patch });

        if (!patchTimeout) {
          patchTimeout = setTimeout(() => {
            setTasks(prev => {
              if (pendingPatches.size === 0) return prev;
              const next = prev.map(task => {
                const patch = pendingPatches.get(task.id);
                return patch ? { ...task, ...patch } : task;
              });
              pendingPatches.clear();
              return next;
            });
            patchTimeout = null;
          }, 64); // ~15fps update rate
        }
      },
    });

    const onOnline = () => {
      setTasks(prev => {
        const waiting = prev.filter(t => t.status === 'waiting_connection');
        for (const t of waiting) {
          engineRef.current?.resume(t.id);
        }
        return prev;
      });
    };

    window.addEventListener('online', onOnline);

    return () => {
      window.removeEventListener('online', onOnline);
      engineRef.current?.dispose();
      engineRef.current = null;
    };
  }, []);

  const addFiles = useCallback((files: File[]) => {
    const now = Date.now();
    const next = files.map((file): UploadTask => ({
      id: makeId(),
      uploadId: undefined,
      file,
      name: file.name,
      size: file.size,
      type: file.type,
      status: 'queued',
      progress: 0,
      uploadedBytes: 0,
      speedBps: 0,
      etaSeconds: Infinity,
      chunkSizeBytes: 0,
      totalChunks: 0,
      uploadedChunks: [],
      previewUrl: file.type.startsWith('image/') ? URL.createObjectURL(file) : undefined,
      showSkeletonUntil: now + 850,
      createdAt: now,
      error: undefined,
    }));

    setTasks(prev => [...next, ...prev]);

    for (const task of next) {
      engineRef.current?.enqueue(task);
    }
  }, []);

  const pauseTask = useCallback((taskId: string) => {
    engineRef.current?.pause(taskId);
  }, []);

  const resumeTask = useCallback((taskId: string) => {
    engineRef.current?.resume(taskId);
  }, []);

  const cancelTask = useCallback((taskId: string) => {
    engineRef.current?.cancel(taskId);
  }, []);

  const retryTask = useCallback((taskId: string) => {
    setTasks(prev => {
      const target = prev.find(t => t.id === taskId);
      if (!target) return prev;

      const reset: UploadTask = {
        ...target,
        uploadId: undefined,
        status: 'queued',
        progress: 0,
        uploadedBytes: 0,
        speedBps: 0,
        etaSeconds: Infinity,
        chunkSizeBytes: 0,
        totalChunks: 0,
        uploadedChunks: [],
        error: undefined,
        createdAt: Date.now(),
      };

      const updated = prev.map(t => (t.id === taskId ? reset : t));
      queueMicrotask(() => engineRef.current?.enqueue(reset));
      return updated;
    });
  }, []);

  const clearCompleted = useCallback(() => {
    setTasks(prev => prev.filter(t => t.status !== 'completed' && t.status !== 'cancelled'));
  }, []);

  const stats = useMemo<UploadStats>(() => {
    if (tasks.length === 0) return initialStats;

    let uploading = 0;
    let queued = 0;
    let completed = 0;
    let failed = 0;
    let paused = 0;
    let speedTotal = 0;
    let speedCount = 0;

    for (const t of tasks) {
      if (t.status === 'uploading') {
        uploading += 1;
        if (t.speedBps > 0) {
          speedTotal += t.speedBps;
          speedCount += 1;
        }
      }
      if (t.status === 'queued' || t.status === 'waiting_connection') queued += 1;
      if (t.status === 'completed') completed += 1;
      if (t.status === 'failed') failed += 1;
      if (t.status === 'paused') paused += 1;
    }

    return {
      uploading,
      queued,
      failed,
      paused,
      completed,
      avgSpeed: speedCount > 0 ? speedTotal / speedCount : 0,
    };
  }, [tasks]);

  return {
    tasks,
    stats,
    addFiles,
    pauseTask,
    resumeTask,
    cancelTask,
    retryTask,
    clearCompleted,
  };
}
