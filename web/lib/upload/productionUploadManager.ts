import { UploadTask, UploadStats, UploadQueueConfig } from './production-types';
import { UploadEngine } from './uploadEngine';
import type { UploadTask as EngineTask } from './types';

type UploadCallback = { onTaskUpdate?: (task: UploadTask) => void; onStatsUpdate?: (stats: UploadStats) => void; onQueueChange?: () => void };

/** Compatibility UI facade. All transfers use the canonical resumable protocol. */
export class ProductionUploadManager {
  private queue = new Map<string, UploadTask>();
  private subscribers = new Set<UploadCallback>();
  private engine = new UploadEngine({ onPatch: (id, patch) => {
    const task = this.queue.get(id);
    if (!task) return;
    Object.assign(task, patch);
    if (patch.status === 'completed') task.completedAt = Date.now();
    this.emit(task);
  } });
  constructor(private config: Partial<UploadQueueConfig> = {}) {}
  private emit(task?: UploadTask) {
    for (const subscriber of this.subscribers) {
      if (task) subscriber.onTaskUpdate?.({ ...task });
      subscriber.onStatsUpdate?.(this.getStats()); subscriber.onQueueChange?.();
    }
  }
  private enqueue(task: UploadTask) {
    this.engine.enqueue({ ...task, folderId: task.folderId ? String(task.folderId) : undefined } as EngineTask);
  }
  addFiles(files: File[], options?: { folderId?: string | number; telegramChatId?: string }) {
    const tasks = files.map(file => ({ id: crypto.randomUUID(), file, name: file.name, size: file.size, type: file.type,
      status: 'queued' as const, progress: 0, uploadedBytes: 0, speedBps: 0, etaSeconds: Infinity, createdAt: Date.now(),
      retryCount: 0, maxRetries: this.config.maxRetries || 3, abortController: new AbortController(), ...options }));
    for (const task of tasks) { this.queue.set(task.id, task); this.enqueue(task); this.emit(task); }
    return tasks;
  }
  getTasks() { return Array.from(this.queue.values()).map(task => ({ ...task })); }
  getStats(): UploadStats {
    const tasks = this.getTasks(); const count = (status: string) => tasks.filter(task => task.status === status).length;
    const totalBytes = tasks.reduce((sum, task) => sum + task.size, 0);
    return { totalFiles: tasks.length, totalBytes, queued: count('queued') + count('waiting_connection'), uploading: count('uploading') + count('processing'), paused: count('paused'), completed: count('completed'), failed: count('failed'), cancelled: count('cancelled'),
      uploadedBytes: tasks.reduce((sum, task) => sum + task.uploadedBytes, 0), uploadedFiles: count('completed'),
      avgSpeed: tasks.reduce((sum, task) => sum + task.speedBps, 0),
      overallProgress: totalBytes ? tasks.reduce((sum, task) => sum + task.size * task.progress, 0) / totalBytes : 0 };
  }
  pauseTask(id: string) { const task = this.queue.get(id); if (!task || !['uploading', 'queued'].includes(task.status)) return false; this.engine.pause(id); return true; }
  resumeTask(id: string) { const task = this.queue.get(id); if (!task || !['paused', 'waiting_connection'].includes(task.status)) return false; this.engine.resume(id); return true; }
  async cancelTask(id: string) { if (!this.queue.has(id)) return false; this.engine.cancel(id); return true; }
  retryTask(id: string) { const task = this.queue.get(id); if (!task || task.status !== 'failed') return false;
    Object.assign(task, { status: 'queued', error: undefined, progress: 0, uploadedBytes: 0, uploadId: undefined }); this.enqueue(task); this.emit(task); return true; }
  clearCompleted() { for (const [id, task] of this.queue) if (['completed', 'cancelled'].includes(task.status)) this.queue.delete(id); this.emit(); }
  on(callbacks: UploadCallback) { this.subscribers.add(callbacks); return () => { this.subscribers.delete(callbacks); }; }
}
let managerInstance: ProductionUploadManager | null = null;
export function getUploadManager(config?: Partial<UploadQueueConfig>) { return managerInstance ||= new ProductionUploadManager(config); }
