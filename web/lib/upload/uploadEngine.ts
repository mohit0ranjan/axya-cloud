import { uploadService } from './uploadService';
import type { UploadTask } from './types';

type Patch = Partial<UploadTask>;

type EngineHooks = {
  onPatch: (taskId: string, patch: Patch) => void;
};

type RuntimeTask = {
  taskId: string;
  file: File;
  size: number;
  name: string;
  uploadId?: string;
  chunkSizeBytes: number;
  totalChunks: number;
  uploadedChunks: Set<number>;
  retriesByChunk: Map<number, number>;
  status: UploadTask['status'];
  paused: boolean;
  cancelled: boolean;
  controllers: Map<number, AbortController>;
  syncTimer?: ReturnType<typeof setInterval>;
  avgSpeedBps: number;
  startedAt: number;
  uploadedBytes: number;
};

const DEFAULT_CHUNK_SIZE = 5 * 1024 * 1024;
const MAX_CONCURRENT_CHUNKS = 3;
const MAX_CHUNK_RETRIES = 3;
const STATUS_SYNC_MS = 8000;

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const isNetworkError = (err: unknown) => {
  const msg = String((err as any)?.message || '').toLowerCase();
  return msg.includes('network') || msg.includes('failed to fetch') || msg.includes('disconnected');
};

const sha256Hex = async (blob: Blob): Promise<string> => {
  const bytes = await blob.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
};

const computeInitHashes = async (file: File): Promise<{ hash?: string; partial_hash?: string }> => {
  const largeThreshold = 64 * 1024 * 1024;
  if (file.size < largeThreshold) {
    const hash = await sha256Hex(file);
    return { hash };
  }

  const sample = 2 * 1024 * 1024;
  const head = file.slice(0, sample);
  const tail = file.slice(Math.max(0, file.size - sample), file.size);
  const combined = new Blob([head, tail, String(file.size)]);
  const partial_hash = await sha256Hex(combined);
  return { partial_hash };
};

export class UploadEngine {
  private hooks: EngineHooks;
  private runtimes = new Map<string, RuntimeTask>();

  constructor(hooks: EngineHooks) {
    this.hooks = hooks;
  }

  public enqueue(task: UploadTask) {
    const runtime: RuntimeTask = {
      taskId: task.id,
      file: task.file,
      size: task.size,
      name: task.name,
      chunkSizeBytes: DEFAULT_CHUNK_SIZE,
      totalChunks: Math.max(1, Math.ceil(task.size / DEFAULT_CHUNK_SIZE)),
      uploadedChunks: new Set<number>(),
      retriesByChunk: new Map<number, number>(),
      status: 'queued',
      paused: false,
      cancelled: false,
      controllers: new Map<number, AbortController>(),
      avgSpeedBps: 0,
      startedAt: Date.now(),
      uploadedBytes: 0,
    };

    this.runtimes.set(task.id, runtime);
    void this.run(runtime);
  }

  public pause(taskId: string) {
    const rt = this.runtimes.get(taskId);
    if (!rt) return;
    rt.paused = true;
    rt.status = 'paused';
    for (const c of rt.controllers.values()) c.abort();
    rt.controllers.clear();
    if (rt.uploadId) {
      void uploadService.pauseUpload(rt.uploadId).catch(() => undefined);
    }
    this.patch(rt.taskId, { status: 'paused', speedBps: 0, etaSeconds: Infinity });
  }

  public resume(taskId: string) {
    const rt = this.runtimes.get(taskId);
    if (!rt || rt.cancelled) return;
    rt.paused = false;
    rt.status = 'queued';
    this.patch(rt.taskId, { status: 'queued', error: undefined });
    void this.resumeFromServer(rt);
  }

  public cancel(taskId: string) {
    const rt = this.runtimes.get(taskId);
    if (!rt) return;
    rt.cancelled = true;
    rt.paused = false;
    rt.status = 'cancelled';
    for (const c of rt.controllers.values()) c.abort();
    rt.controllers.clear();
    if (rt.syncTimer) clearInterval(rt.syncTimer);
    if (rt.uploadId) {
      void uploadService.cancelUpload(rt.uploadId).catch(() => undefined);
    }
    this.patch(rt.taskId, { status: 'cancelled', speedBps: 0, etaSeconds: Infinity });
    this.finalizeRuntime(rt);
  }

  public dispose() {
    for (const rt of this.runtimes.values()) {
      for (const c of rt.controllers.values()) c.abort();
      rt.controllers.clear();
      if (rt.syncTimer) clearInterval(rt.syncTimer);
    }
    this.runtimes.clear();
  }

  private async run(rt: RuntimeTask) {
    try {
      const hashes: { hash?: string; partial_hash?: string } = await computeInitHashes(rt.file).catch(() => ({}));
      const init = await uploadService.initUpload({
        originalname: rt.name,
        size: rt.size,
        mimetype: rt.file.type || 'application/octet-stream',
        chunk_size_bytes: DEFAULT_CHUNK_SIZE,
        upload_mode: 'chunk',
        hash: hashes.hash,
        partial_hash: hashes.partial_hash,
      });

      if (init?.duplicate) {
        this.patch(rt.taskId, {
          status: 'completed',
          progress: 100,
          uploadedBytes: rt.size,
          speedBps: 0,
          etaSeconds: 0,
        });
        this.finalizeRuntime(rt);
        return;
      }

      rt.uploadId = String(init.uploadId || init.upload_id || '').trim();
      if (!rt.uploadId) throw new Error('Upload session not created');

      rt.chunkSizeBytes = Number(init.chunkSizeBytes || DEFAULT_CHUNK_SIZE);
      rt.totalChunks = Number(init.totalChunks || Math.max(1, Math.ceil(rt.size / rt.chunkSizeBytes)));
      rt.status = init.status === 'queued' ? 'queued' : 'uploading';

      this.patch(rt.taskId, {
        uploadId: rt.uploadId,
        chunkSizeBytes: rt.chunkSizeBytes,
        totalChunks: rt.totalChunks,
        status: rt.status,
        uploadedChunks: [],
      });

      this.startSyncTimer(rt);
      await this.uploadMissingChunks(rt);

      if (rt.cancelled || rt.paused) return;
      if (rt.uploadedChunks.size >= rt.totalChunks) {
        await uploadService.completeUpload(rt.uploadId);
        this.patch(rt.taskId, {
          status: 'completed',
          progress: 100,
          uploadedBytes: rt.size,
          speedBps: 0,
          etaSeconds: 0,
        });
        this.finalizeRuntime(rt);
      }
    } catch (err: any) {
      if (rt.cancelled) return;
      if (isNetworkError(err)) {
        rt.paused = true;
        rt.status = 'waiting_connection';
        this.patch(rt.taskId, {
          status: 'waiting_connection',
          error: 'Waiting for connection',
          speedBps: 0,
          etaSeconds: Infinity,
        });
        return;
      }

      this.patch(rt.taskId, {
        status: 'failed',
        error: String(err?.message || 'Upload failed'),
        speedBps: 0,
        etaSeconds: Infinity,
      });
      this.finalizeRuntime(rt);
    }
  }

  private async uploadMissingChunks(rt: RuntimeTask) {
    rt.status = 'uploading';
    this.patch(rt.taskId, { status: 'uploading', error: undefined });

    const queue: number[] = [];
    for (let i = 0; i < rt.totalChunks; i += 1) {
      if (!rt.uploadedChunks.has(i)) queue.push(i);
    }

    let pointer = 0;
    const workers = Array.from({ length: Math.min(MAX_CONCURRENT_CHUNKS, queue.length) }).map(async () => {
      while (pointer < queue.length && !rt.paused && !rt.cancelled && rt.status !== 'queued') {
        const chunkIndex = queue[pointer++];
        await this.uploadChunkWithRetry(rt, chunkIndex);
      }
    });

    await Promise.all(workers);
  }

  private async uploadChunkWithRetry(rt: RuntimeTask, chunkIndex: number): Promise<void> {
    if (!rt.uploadId || rt.paused || rt.cancelled) return;

    const attempt = rt.retriesByChunk.get(chunkIndex) || 0;
    const start = chunkIndex * rt.chunkSizeBytes;
    const end = Math.min(rt.size, start + rt.chunkSizeBytes);
    const blob = rt.file.slice(start, end);

    const controller = new AbortController();
    rt.controllers.set(chunkIndex, controller);

    const t0 = performance.now();
    try {
      const payload = await uploadService.uploadChunk({
        uploadId: rt.uploadId,
        chunkIndex,
        chunkBlob: blob,
        signal: controller.signal,
      });

      if (payload?.duplicate || payload?.success) {
        rt.uploadedChunks.add(chunkIndex);
        rt.uploadedBytes = Math.min(rt.size, rt.uploadedBytes + blob.size);
      }

      const t1 = performance.now();
      const elapsedSec = Math.max(0.1, (t1 - t0) / 1000);
      const chunkSpeed = blob.size / elapsedSec;
      rt.avgSpeedBps = rt.avgSpeedBps === 0 ? chunkSpeed : (rt.avgSpeedBps * 0.8) + (chunkSpeed * 0.2);

      const uploadedBytes = Math.min(rt.size, rt.uploadedBytes);
      const progress = Math.min(100, (uploadedBytes / rt.size) * 100);
      const remaining = Math.max(0, rt.size - uploadedBytes);
      const eta = rt.avgSpeedBps > 0 ? remaining / rt.avgSpeedBps : Infinity;

      this.patch(rt.taskId, {
        status: 'uploading',
        uploadedBytes,
        progress,
        speedBps: rt.avgSpeedBps,
        etaSeconds: eta,
        uploadedChunks: [...rt.uploadedChunks].sort((a, b) => a - b),
        totalChunks: rt.totalChunks,
        error: undefined,
      });
    } catch (err: any) {
      if (rt.paused || rt.cancelled) return;
      if (String(err?.name || '').toLowerCase() === 'aborterror') return;

      if (isNetworkError(err)) {
        rt.paused = true;
        rt.status = 'waiting_connection';
        this.patch(rt.taskId, {
          status: 'waiting_connection',
          error: 'Waiting for connection',
          speedBps: 0,
          etaSeconds: Infinity,
        });
        return;
      }

      const status = Number((err as any)?.status || 0);
      const code = String((err as any)?.payload?.code || '').toUpperCase();
      if (status === 409 && code === 'UPLOAD_QUEUED') {
        if (rt.status !== 'queued') {
          rt.status = 'queued';
          this.patch(rt.taskId, {
            status: 'queued',
            speedBps: 0,
            etaSeconds: Infinity,
          });
        }
        return; // stop uploading chunks; syncTimer will resume when promoted
      }

      if (attempt + 1 < MAX_CHUNK_RETRIES) {
        rt.retriesByChunk.set(chunkIndex, attempt + 1);
        await sleep(400 * Math.pow(2, attempt));
        return this.uploadChunkWithRetry(rt, chunkIndex);
      }

      this.patch(rt.taskId, {
        status: 'failed',
        error: `Chunk ${chunkIndex + 1} failed after retries`,
        speedBps: 0,
        etaSeconds: Infinity,
      });
      throw err;
    } finally {
      rt.controllers.delete(chunkIndex);
    }
  }

  private async resumeFromServer(rt: RuntimeTask) {
    if (!rt.uploadId || rt.cancelled) return;

    try {
      await uploadService.resumeUpload(rt.uploadId).catch(() => undefined);
      const status = await uploadService.getUploadStatus(rt.uploadId);
      const uploadedChunks = Array.isArray(status?.uploadedChunks) ? status.uploadedChunks.map((n: any) => Number(n)) : [];
      rt.uploadedChunks = new Set(uploadedChunks.filter((n: number) => Number.isFinite(n) && n >= 0));
      rt.totalChunks = Number(status?.totalChunks || rt.totalChunks);

      const uploadedBytes = Number(status?.receivedBytes || 0);
      rt.uploadedBytes = Math.max(rt.uploadedBytes, uploadedBytes);
      const progress = Math.min(100, (uploadedBytes / Math.max(1, rt.size)) * 100);
      this.patch(rt.taskId, {
        status: 'queued',
        uploadedChunks: [...rt.uploadedChunks].sort((a, b) => a - b),
        uploadedBytes,
        progress,
        totalChunks: rt.totalChunks,
        error: undefined,
      });

      await this.uploadMissingChunks(rt);
      if (!rt.paused && !rt.cancelled && rt.uploadedChunks.size >= rt.totalChunks) {
        await uploadService.completeUpload(rt.uploadId);
        this.patch(rt.taskId, {
          status: 'completed',
          progress: 100,
          uploadedBytes: rt.size,
          speedBps: 0,
          etaSeconds: 0,
        });
        this.finalizeRuntime(rt);
      }
    } catch (err: any) {
      if (isNetworkError(err)) {
        this.patch(rt.taskId, { status: 'waiting_connection', error: 'Waiting for connection' });
        return;
      }
      this.patch(rt.taskId, { status: 'failed', error: String(err?.message || 'Resume failed') });
      this.finalizeRuntime(rt);
    }
  }

  private startSyncTimer(rt: RuntimeTask) {
    if (!rt.uploadId) return;
    if (rt.syncTimer) clearInterval(rt.syncTimer);

    rt.syncTimer = setInterval(() => {
      if (!rt.uploadId || rt.cancelled) return;
      void uploadService.getUploadStatus(rt.uploadId)
        .then((status) => {
          const uploadedChunks = Array.isArray(status?.uploadedChunks)
            ? status.uploadedChunks.map((n: any) => Number(n)).filter((n: number) => Number.isFinite(n) && n >= 0)
            : [];
          if (uploadedChunks.length > 0) {
            rt.uploadedChunks = new Set(uploadedChunks);
          }

          const uploadedBytes = Number(status?.receivedBytes || 0);
          rt.uploadedBytes = Math.max(rt.uploadedBytes, uploadedBytes);
          const progress = Math.min(100, (uploadedBytes / Math.max(1, rt.size)) * 100);
          const serverState = String(status?.status || '').toLowerCase();

          if (serverState === 'completed') {
            this.patch(rt.taskId, {
              status: 'completed',
              progress: 100,
              uploadedBytes: rt.size,
              speedBps: 0,
              etaSeconds: 0,
            });
            this.finalizeRuntime(rt);
            return;
          }
          if (serverState === 'paused') {
            this.patch(rt.taskId, { status: 'paused', uploadedBytes, progress });
            return;
          }
          if (serverState === 'cancelled') {
            this.patch(rt.taskId, { status: 'cancelled', uploadedBytes, progress, speedBps: 0 });
            return;
          }
          
          if (serverState === 'failed') {
             this.patch(rt.taskId, { status: 'failed', uploadedBytes, progress, speedBps: 0 });
             this.finalizeRuntime(rt);
             return;
          }

          if (serverState === 'queued' && rt.status !== 'queued') {
            rt.status = 'queued';
            this.patch(rt.taskId, { status: 'queued', speedBps: 0, etaSeconds: Infinity });
          } else if (serverState === 'uploading' && rt.status === 'queued') {
            rt.status = 'uploading';
            this.patch(rt.taskId, { status: 'uploading' });
            void this.uploadMissingChunks(rt);
            return;
          }

          this.patch(rt.taskId, {
            uploadedBytes,
            progress,
            uploadedChunks: [...rt.uploadedChunks].sort((a, b) => a - b),
            totalChunks: Number(status?.totalChunks || rt.totalChunks),
          });
        })
        .catch(() => undefined);
    }, STATUS_SYNC_MS);
  }

  private patch(taskId: string, patch: Patch) {
    this.hooks.onPatch(taskId, patch);
  }

  private finalizeRuntime(rt: RuntimeTask) {
    if (rt.syncTimer) {
      clearInterval(rt.syncTimer);
      rt.syncTimer = undefined;
    }
    for (const controller of rt.controllers.values()) controller.abort();
    rt.controllers.clear();
    this.runtimes.delete(rt.taskId);
  }
}
