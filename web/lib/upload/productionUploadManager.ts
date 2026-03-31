import { UploadTask, UploadTaskStatus, UploadStats, UploadQueueConfig, UploadResponse } from './production-types';

const DEFAULT_CONFIG: UploadQueueConfig = {
  maxConcurrent: 3,
  maxRetries: 3,
  retryDelayMs: 2000,
  apiUrl: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000',
};

type UploadCallback = {
  onTaskUpdate?: (task: UploadTask) => void;
  onStatsUpdate?: (stats: UploadStats) => void;
  onQueueChange?: () => void;
};

export class ProductionUploadManager {
  private queue: Map<string, UploadTask> = new Map();
  private running: Map<string, Promise<void>> = new Map();
  private paused: Set<string> = new Set();
  private config: UploadQueueConfig;
  private callbacks: UploadCallback = {};
  private speedTracker: Map<string, { bytes: number; startTime: number }> = new Map();
  private stats: UploadStats = {
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
  };

  constructor(config: Partial<UploadQueueConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.startQueueProcessor();
  }

  /**
   * Add files to upload queue
   */
  addFiles(
    files: File[],
    options?: { folderId?: number; telegramChatId?: string }
  ): UploadTask[] {
    const tasks: UploadTask[] = [];

    for (const file of files) {
      const task = this.createTask(file, options);
      this.queue.set(task.id, task);
      tasks.push(task);
      this.updateStats();
      this.callbacks.onTaskUpdate?.(task);
    }

    this.callbacks.onQueueChange?.();
    return tasks;
  }

  /**
   * Get all tasks
   */
  getTasks(): UploadTask[] {
    return Array.from(this.queue.values());
  }

  /**
   * Get stats snapshot
   */
  getStats(): UploadStats {
    return { ...this.stats };
  }

  /**
   * Pause a task
   */
  pauseTask(taskId: string): boolean {
    const task = this.queue.get(taskId);
    if (!task || task.status !== 'uploading') return false;

    this.paused.add(taskId);
    task.status = 'paused';
    this.updateStats();
    this.callbacks.onTaskUpdate?.(task);
    return true;
  }

  /**
   * Resume a paused task
   */
  resumeTask(taskId: string): boolean {
    const task = this.queue.get(taskId);
    if (!task || task.status !== 'paused') return false;

    this.paused.delete(taskId);
    task.status = 'queued';
    this.updateStats();
    this.callbacks.onTaskUpdate?.(task);
    this.callbacks.onQueueChange?.();
    return true;
  }

  /**
   * Cancel a task
   */
  async cancelTask(taskId: string): Promise<boolean> {
    const task = this.queue.get(taskId);
    if (!task) return false;

    // Abort the upload
    task.abortController.abort();
    task.status = 'cancelled';
    this.paused.delete(taskId);
    this.updateStats();
    this.callbacks.onTaskUpdate?.(task);
    
    // Wait for running task to finish
    if (this.running.has(taskId)) {
      try {
        await this.running.get(taskId);
      } catch {
        // ignore
      }
    }

    return true;
  }

  /**
   * Retry a failed task
   */
  retryTask(taskId: string): boolean {
    const task = this.queue.get(taskId);
    if (!task || task.status !== 'failed') return false;

    task.status = 'queued';
    task.uploadedBytes = 0;
    task.progress = 0;
    task.error = undefined;
    task.errorCode = undefined;
    task.abortController = new AbortController();
    this.paused.delete(taskId);
    this.updateStats();
    this.callbacks.onTaskUpdate?.(task);
    this.callbacks.onQueueChange?.();
    return true;
  }

  /**
   * Clear completed tasks
   */
  clearCompleted(): void {
    const toRemove: string[] = [];
    for (const [id, task] of this.queue) {
      if (task.status === 'completed' || task.status === 'cancelled') {
        toRemove.push(id);
      }
    }
    toRemove.forEach((id) => this.queue.delete(id));
    this.updateStats();
    this.callbacks.onQueueChange?.();
  }

  /**
   * Register callbacks
   */
  on(callbacks: UploadCallback): void {
    this.callbacks = { ...this.callbacks, ...callbacks };
  }

  // =========================================================================
  // PRIVATE
  // =========================================================================

  private createTask(file: File, options?: any): UploadTask {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    return {
      id,
      file,
      name: file.name,
      size: file.size,
      type: file.type,
      mimeType: file.type,
      status: 'queued',
      progress: 0,
      uploadedBytes: 0,
      speedBps: 0,
      etaSeconds: 0,
      createdAt: Date.now(),
      retryCount: 0,
      maxRetries: this.config.maxRetries,
      abortController: new AbortController(),
      folderId: options?.folderId,
      telegramChatId: options?.telegramChatId,
    };
  }

  private startQueueProcessor(): void {
    setInterval(() => {
      this.processQueue();
    }, 100);
  }

  private async processQueue(): Promise<void> {
    const uploading = Array.from(this.running.keys()).length;
    const available = this.config.maxConcurrent - uploading;

    if (available <= 0) return;

    // Find next queued tasks
    const queued = Array.from(this.queue.values())
      .filter(
        (t) =>
          t.status === 'queued' &&
          !this.running.has(t.id) &&
          !this.paused.has(t.id)
      )
      .slice(0, available);

    for (const task of queued) {
      const uploadPromise = this.uploadTask(task);
      this.running.set(task.id, uploadPromise);

      uploadPromise
        .then(() => {
          this.running.delete(task.id);
        })
        .catch(() => {
          this.running.delete(task.id);
        });
    }
  }

  private async uploadTask(task: UploadTask): Promise<void> {
    try {
      task.status = 'uploading';
      task.startedAt = Date.now();
      task.uploadedBytes = 0;
      task.progress = 0;
      this.updateStats();
      this.callbacks.onTaskUpdate?.(task);

      const formData = new FormData();
      formData.append('file', task.file);

      if (task.folderId) {
        formData.append('folderId', String(task.folderId));
      }
      if (task.telegramChatId) {
        formData.append('telegramChatId', task.telegramChatId);
      }

      // Track upload progress
      const xhr = new XMLHttpRequest();

      const uploadStartTime = Date.now();
      const speedTracker = { bytes: 0, startTime: uploadStartTime };
      this.speedTracker.set(task.id, speedTracker);

      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable) {
          task.uploadedBytes = e.loaded;
          task.progress = Math.floor((e.loaded / e.total) * 100);

          // Calculate speed
          const elapsed = (Date.now() - uploadStartTime) / 1000;
          if (elapsed > 0) {
            task.speedBps = Math.floor(e.loaded / elapsed);
            const remaining = e.total - e.loaded;
            task.etaSeconds = Math.floor(remaining / task.speedBps);
          }

          this.updateStats();
          this.callbacks.onTaskUpdate?.(task);
        }
      });

      return new Promise((resolve, reject) => {
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            const response: UploadResponse = JSON.parse(xhr.responseText);
            task.status = 'completed';
            task.completedAt = Date.now();
            task.progress = 100;
            this.speedTracker.delete(task.id);
            this.updateStats();
            this.callbacks.onTaskUpdate?.(task);
            resolve();
          } else {
            throw new Error(`Upload failed with status ${xhr.status}`);
          }
        };

        xhr.onerror = () => {
          if (task.abortController.signal.aborted) {
            reject(new Error('Upload cancelled'));
          } else {
            reject(new Error('Network error'));
          }
        };

        xhr.onabort = () => {
          reject(new Error('Upload cancelled'));
        };

        xhr.open('POST', `${this.config.apiUrl}/upload/file`);

        // Add auth (example: if token is stored in localStorage)
        const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null;
        if (token) {
          xhr.setRequestHeader('Authorization', `Bearer ${token}`);
        }

        xhr.send(formData);

        // Handle abort controller
        task.abortController.signal.addEventListener('abort', () => {
          xhr.abort();
        });
      });
    } catch (err: any) {
      const isAborted = task.abortController.signal.aborted;

      if (isAborted) {
        task.status = 'cancelled';
      } else if (task.retryCount < task.maxRetries) {
        task.retryCount++;
        task.status = 'retrying';
        this.updateStats();
        this.callbacks.onTaskUpdate?.(task);

        // Wait before retrying
        await new Promise((r) => setTimeout(r, this.config.retryDelayMs));

        task.status = 'queued';
        this.callbacks.onTaskUpdate?.(task);
      } else {
        task.status = 'failed';
        task.error = err.message;
        task.errorCode = err.code || 'UPLOAD_ERROR';
      }

      this.speedTracker.delete(task.id);
      this.updateStats();
      this.callbacks.onTaskUpdate?.(task);
    }
  }

  private updateStats(): void {
    const tasks = Array.from(this.queue.values());

    this.stats = {
      totalFiles: tasks.length,
      totalBytes: tasks.reduce((sum, t) => sum + t.size, 0),
      queued: tasks.filter((t) => t.status === 'queued').length,
      uploading: tasks.filter((t) => t.status === 'uploading').length,
      paused: tasks.filter((t) => t.status === 'paused').length,
      completed: tasks.filter((t) => t.status === 'completed').length,
      failed: tasks.filter((t) => t.status === 'failed').length,
      cancelled: tasks.filter((t) => t.status === 'cancelled').length,
      uploadedBytes: tasks.reduce((sum, t) => sum + t.uploadedBytes, 0),
      uploadedFiles: tasks.filter((t) => t.status === 'completed').length,
      avgSpeed: this.calculateAvgSpeed(tasks),
      overallProgress:
        tasks.length > 0
          ? Math.floor(
              (tasks.reduce((sum, t) => sum + t.progress, 0) / tasks.length)
            )
          : 0,
    };

    this.callbacks.onStatsUpdate?.(this.stats);
  }

  private calculateAvgSpeed(tasks: UploadTask[]): number {
    const uploading = tasks.filter((t) => t.status === 'uploading');
    if (uploading.length === 0) return 0;
    return Math.floor(
      uploading.reduce((sum, t) => sum + t.speedBps, 0) / uploading.length
    );
  }
}

// Singleton instance
let managerInstance: ProductionUploadManager | null = null;

export function getUploadManager(
  config?: Partial<UploadQueueConfig>
): ProductionUploadManager {
  if (!managerInstance) {
    managerInstance = new ProductionUploadManager(config);
  }
  return managerInstance;
}
