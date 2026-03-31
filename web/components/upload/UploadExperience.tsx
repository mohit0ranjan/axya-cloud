'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  CheckCircle2,
  Clock3,
  FolderUp,
  Pause,
  Play,
  Upload,
  X,
  AlertTriangle,
  ChevronUp,
  ChevronDown,
  Image as ImageIcon,
} from 'lucide-react';
import { useUploadManager } from '../../hooks/useUploadManager';
import type { UploadStatus } from '../../lib/upload/types';

type ToastItem = {
  id: string;
  kind: 'info' | 'success' | 'error';
  message: string;
};

const fmtSize = (bytes: number) => {
  if (bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const idx = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / Math.pow(1024, idx);
  return `${value.toFixed(idx === 0 ? 0 : 1)} ${units[idx]}`;
};

const fmtSpeed = (bps: number) => `${(bps / (1024 * 1024)).toFixed(1)} MB/s`;

const fmtEta = (seconds: number) => {
  if (!Number.isFinite(seconds) || seconds <= 0) return 'Finishing...';
  const s = Math.round(seconds);
  const min = Math.floor(s / 60);
  const sec = s % 60;
  if (min <= 0) return `${sec}s`;
  return `${min}m ${sec}s`;
};

const progressColor = (status: UploadStatus) => {
  if (status === 'failed') return 'bg-red-500';
  if (status === 'paused') return 'bg-amber-500';
  if (status === 'completed') return 'bg-emerald-500';
  return 'bg-blue-500';
};

const statusLabel = (status: UploadStatus) => {
  switch (status) {
    case 'queued':
      return 'Queued';
    case 'uploading':
      return 'Uploading';
    case 'paused':
      return 'Paused';
    case 'completed':
      return 'Completed';
    case 'failed':
      return 'Failed';
    case 'cancelled':
      return 'Cancelled';
    case 'waiting_connection':
      return 'Waiting for connection';
    default:
      return status;
  }
};

export default function UploadExperience() {
  const {
    tasks,
    stats,
    addFiles,
    pauseTask: pauseTaskCore,
    resumeTask: resumeTaskCore,
    cancelTask: cancelTaskCore,
    retryTask,
    clearCompleted,
  } = useUploadManager();
  const [panelOpen, setPanelOpen] = useState(false);
  const [cardExpanded, setCardExpanded] = useState(true);
  const [dragActive, setDragActive] = useState(false);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [soundEnabled, setSoundEnabled] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const prevStatusByTaskRef = useRef<Map<string, UploadStatus>>(new Map());

  const audioCtxRef = useRef<any>(null);

  const playTone = useCallback((kind: 'success' | 'error' | 'info') => {
    if (!soundEnabled || typeof window === 'undefined') return;
    try {
      if (!audioCtxRef.current) {
        const AudioCtx = (window as any).AudioContext || (window as any).webkitAudioContext;
        if (!AudioCtx) return;
        audioCtxRef.current = new AudioCtx();
      }
      const ctx = audioCtxRef.current;
      if (ctx.state === 'suspended') {
        ctx.resume();
      }
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(kind === 'success' ? 740 : kind === 'error' ? 220 : 440, ctx.currentTime);
      gain.gain.setValueAtTime(0.02, ctx.currentTime);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.12);
    } catch { }
  }, [soundEnabled]);

  const pushToast = useCallback((kind: ToastItem['kind'], message: string) => {
    const id = crypto.randomUUID();
    setToasts(prev => [{ id, kind, message }, ...prev].slice(0, 4));
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 2800);
    playTone(kind === 'success' ? 'success' : kind === 'error' ? 'error' : 'info');
  }, [playTone]);

  useEffect(() => {
    const prev = prevStatusByTaskRef.current;
    for (const task of tasks) {
      const old = prev.get(task.id);
      if (old && old !== task.status) {
        if (task.status === 'uploading') {
          pushToast('info', `Started: ${task.name}`);
        } else if (task.status === 'completed') {
          pushToast('success', `Completed: ${task.name}`);
        } else if (task.status === 'failed') {
          pushToast('error', `Failed: ${task.name}`);
        } else if (task.status === 'waiting_connection') {
          pushToast('info', `Waiting for connection: ${task.name}`);
        }
      }
      prev.set(task.id, task.status);
    }
    const existingIds = new Set(tasks.map(t => t.id));
    for (const key of Array.from(prev.keys())) {
      if (!existingIds.has(key)) prev.delete(key);
    }
  }, [tasks, pushToast]);

  useEffect(() => {
    const onDragEnter = (e: DragEvent) => {
      e.preventDefault();
      setDragActive(true);
    };
    const onDragOver = (e: DragEvent) => e.preventDefault();
    const onDragLeave = (e: DragEvent) => {
      e.preventDefault();
      if ((e.target as HTMLElement)?.nodeName === 'HTML') {
        setDragActive(false);
      }
    };
    const onDrop = (e: DragEvent) => {
      e.preventDefault();
      setDragActive(false);
      if (!e.dataTransfer?.files?.length) return;
      enqueueFiles(Array.from(e.dataTransfer.files));
    };

    window.addEventListener('dragenter', onDragEnter);
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('dragleave', onDragLeave);
    window.addEventListener('drop', onDrop);

    return () => {
      window.removeEventListener('dragenter', onDragEnter);
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('dragleave', onDragLeave);
      window.removeEventListener('drop', onDrop);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const tasksRef = useRef(tasks);
  useEffect(() => {
    tasksRef.current = tasks;
  }, [tasks]);

  useEffect(() => {
    return () => {
      for (const t of tasksRef.current) {
        if (t.previewUrl) URL.revokeObjectURL(t.previewUrl);
      }
    };
  }, []);

  const enqueueFiles = useCallback((files: File[]) => {
    addFiles(files);
    pushToast('info', `${files.length} file${files.length > 1 ? 's' : ''} added to upload queue`);
    setCardExpanded(true);
  }, [addFiles, pushToast]);

  const onPickFiles = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const chosen = event.target.files ? Array.from(event.target.files) : [];
    if (chosen.length > 0) enqueueFiles(chosen);
    event.target.value = '';
  }, [enqueueFiles]);

  const pauseTask = useCallback((id: string) => {
    pauseTaskCore(id);
  }, [pauseTaskCore]);

  const resumeTask = useCallback((id: string) => {
    const task = tasks.find(t => t.id === id);
    if (!task) return;
    if (task.status === 'failed') {
      retryTask(id);
      return;
    }
    resumeTaskCore(id);
  }, [tasks, resumeTaskCore, retryTask]);

  const cancelTask = useCallback((id: string) => {
    const task = tasks.find(t => t.id === id);
    if (task?.previewUrl) URL.revokeObjectURL(task.previewUrl);
    cancelTaskCore(id);
  }, [tasks, cancelTaskCore]);

  const clearFinished = useCallback(() => {
    for (const t of tasks) {
      if ((t.status === 'completed' || t.status === 'cancelled') && t.previewUrl) {
        URL.revokeObjectURL(t.previewUrl);
      }
    }
    clearCompleted();
  }, [tasks, clearCompleted]);

  const visibleTasks = tasks.slice(0, 4);

  return (
    <>
      {dragActive && (
        <div className="fixed inset-0 z-[60] grid place-items-center bg-blue-500/10 backdrop-blur-[1px]">
          <div className="rounded-3xl border-2 border-dashed border-blue-500 bg-white/95 px-10 py-12 text-center shadow-2xl">
            <FolderUp className="mx-auto h-10 w-10 text-blue-600" />
            <p className="mt-3 text-lg font-semibold text-slate-900">Drop files to upload</p>
            <p className="mt-1 text-sm text-slate-500">Uploads start instantly with optimistic progress.</p>
          </div>
        </div>
      )}

      <div className="fixed right-6 top-6 z-[70] space-y-2">
        {toasts.map(toast => (
          <div
            key={toast.id}
            className={`rounded-xl border px-3 py-2 text-sm shadow-lg backdrop-blur transition ${
              toast.kind === 'success'
                ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                : toast.kind === 'error'
                ? 'border-red-200 bg-red-50 text-red-700'
                : 'border-blue-200 bg-blue-50 text-blue-700'
            }`}
          >
            {toast.message}
          </div>
        ))}
      </div>

      <input ref={fileInputRef} type="file" multiple className="hidden" onChange={onPickFiles} />

      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        className="fixed bottom-28 right-6 z-40 inline-flex items-center gap-2 rounded-full bg-[#1a73e8] px-5 py-3 text-sm font-semibold text-white shadow-[0_10px_25px_-10px_rgba(26,115,232,0.75)] transition hover:-translate-y-0.5 hover:bg-[#1558b9]"
      >
        <Upload className="h-4 w-4" />
        Upload Files
      </button>

      <section className="fixed bottom-6 right-6 z-50 w-[min(92vw,380px)]">
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl shadow-slate-900/10">
          <button
            type="button"
            onClick={() => setCardExpanded(v => !v)}
            className="flex w-full items-center justify-between bg-slate-50 px-4 py-3 text-left"
          >
            <div>
              <p className="text-sm font-semibold text-slate-900">Uploads</p>
              <p className="text-xs text-slate-500">
                {stats.uploading} uploading · {stats.queued} queued · {stats.paused} paused
              </p>
            </div>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={e => {
                  e.stopPropagation();
                  setPanelOpen(true);
                }}
                className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-blue-600 ring-1 ring-slate-200 transition hover:bg-blue-50"
              >
                Open Manager
              </button>
              {cardExpanded ? <ChevronDown className="h-4 w-4 text-slate-500" /> : <ChevronUp className="h-4 w-4 text-slate-500" />}
            </div>
          </button>

          {cardExpanded && (
            <div className="space-y-3 p-4">
              {visibleTasks.length === 0 && (
                <p className="rounded-xl bg-slate-50 px-3 py-4 text-center text-sm text-slate-500">
                  No active uploads yet. Drag files anywhere to begin.
                </p>
              )}

              {visibleTasks.map(task => (
                <div key={task.id} className="rounded-xl border border-slate-100 p-3 transition hover:border-slate-200">
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <p className="truncate text-sm font-medium text-slate-800">{task.name}</p>
                    <span className="text-[11px] font-semibold text-slate-500">{Math.round(task.progress)}%</span>
                  </div>

                  <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
                    <div
                      className={`h-full rounded-full transition-all duration-300 ${progressColor(task.status)}`}
                      style={{ width: `${task.progress}%` }}
                    />
                  </div>

                  <p className="mt-1.5 text-[11px] text-slate-500">
                    {statusLabel(task.status)}
                    {task.status === 'uploading' ? ` · ${fmtSpeed(task.speedBps)} · ETA ${fmtEta(task.etaSeconds)}` : ''}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      <aside
        className={`fixed right-0 top-0 z-[55] h-screen w-[min(96vw,460px)] border-l border-slate-200 bg-white shadow-2xl transition-transform duration-300 ${
          panelOpen ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Upload Manager</h2>
            <p className="text-xs text-slate-500">Background queue stays active while panel is closed.</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setSoundEnabled(v => !v)}
              className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${soundEnabled ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-600'}`}
            >
              Sound {soundEnabled ? 'On' : 'Off'}
            </button>
            <button type="button" onClick={() => setPanelOpen(false)} className="rounded-full p-2 text-slate-500 hover:bg-slate-100">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="grid grid-cols-4 gap-2 border-b border-slate-100 px-5 py-3 text-center text-xs">
          <div className="rounded-lg bg-blue-50 px-2 py-2 text-blue-700">{stats.uploading}<br />Uploading</div>
          <div className="rounded-lg bg-slate-100 px-2 py-2 text-slate-700">{stats.queued}<br />Queued</div>
          <div className="rounded-lg bg-amber-50 px-2 py-2 text-amber-700">{stats.paused}<br />Paused</div>
          <div className="rounded-lg bg-red-50 px-2 py-2 text-red-700">{stats.failed}<br />Failed</div>
        </div>

        <div className="h-[calc(100vh-170px)] space-y-3 overflow-y-auto p-4">
          {tasks.length === 0 && (
            <div className="rounded-2xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">
              Start by dropping files or using the Upload Files button.
            </div>
          )}

          {tasks.map(task => {
            const showSkeleton = typeof task.showSkeletonUntil === 'number' && Date.now() < task.showSkeletonUntil;
            return (
              <article key={task.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition">
                <div className="flex items-start gap-3">
                  <div className="h-12 w-12 overflow-hidden rounded-xl bg-slate-100">
                    {task.previewUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={task.previewUrl} alt={task.name} className="h-full w-full object-cover" loading="lazy" decoding="async" />
                    ) : (
                      <div className="grid h-full w-full place-items-center text-slate-400">
                        <ImageIcon className="h-5 w-5" />
                      </div>
                    )}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="truncate text-sm font-semibold text-slate-800">{task.name}</h3>
                      <span className="text-xs font-semibold text-slate-500">{statusLabel(task.status)}</span>
                    </div>
                    <p className="text-xs text-slate-500">{fmtSize(task.uploadedBytes)} / {fmtSize(task.size)}</p>

                    {showSkeleton ? (
                      <div className="mt-3 space-y-2">
                        <div className="h-2 animate-pulse rounded-full bg-slate-100" />
                        <div className="h-2 w-1/2 animate-pulse rounded-full bg-slate-100" />
                      </div>
                    ) : (
                      <>
                        <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100">
                          <div
                            className={`h-full rounded-full transition-all duration-300 ${progressColor(task.status)}`}
                            style={{ width: `${task.progress}%` }}
                          />
                        </div>
                        <div className="mt-2 flex items-center justify-between text-xs text-slate-500">
                          <span>{Math.round(task.progress)}%</span>
                          {task.status === 'uploading' ? <span>{fmtSpeed(task.speedBps)} · ETA {fmtEta(task.etaSeconds)}</span> : <span />}
                        </div>
                      </>
                    )}

                    {task.error && (
                      <div className="mt-2 inline-flex items-center gap-1 rounded-md bg-red-50 px-2 py-1 text-[11px] text-red-700">
                        <AlertTriangle className="h-3 w-3" />
                        {task.error}
                      </div>
                    )}

                    <div className="mt-3 flex items-center gap-2">
                      {(task.status === 'uploading' || task.status === 'queued') && (
                        <button type="button" onClick={() => pauseTask(task.id)} className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50">
                          <Pause className="mr-1 inline h-3.5 w-3.5" />Pause
                        </button>
                      )}
                      {(task.status === 'paused' || task.status === 'waiting_connection') && (
                        <button type="button" onClick={() => resumeTask(task.id)} className="rounded-lg border border-blue-200 bg-blue-50 px-2.5 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-100">
                          <Play className="mr-1 inline h-3.5 w-3.5" />Resume
                        </button>
                      )}
                      {task.status === 'failed' && (
                        <button type="button" onClick={() => resumeTask(task.id)} className="rounded-lg border border-blue-200 bg-blue-50 px-2.5 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-100">
                          <Play className="mr-1 inline h-3.5 w-3.5" />Retry
                        </button>
                      )}
                      {task.status !== 'completed' && task.status !== 'cancelled' && (
                        <button type="button" onClick={() => cancelTask(task.id)} className="rounded-lg border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-100">
                          <X className="mr-1 inline h-3.5 w-3.5" />Cancel
                        </button>
                      )}
                      {task.status === 'completed' && (
                        <span className="inline-flex items-center gap-1 rounded-lg bg-emerald-50 px-2.5 py-1.5 text-xs font-semibold text-emerald-700">
                          <CheckCircle2 className="h-3.5 w-3.5" />Done
                        </span>
                      )}
                      {task.status === 'queued' && (
                        <span className="inline-flex items-center gap-1 rounded-lg bg-slate-100 px-2.5 py-1.5 text-xs font-semibold text-slate-700">
                          <Clock3 className="h-3.5 w-3.5" />Waiting
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </article>
            );
          })}
        </div>

        <div className="border-t border-slate-100 px-4 py-3">
          <button type="button" onClick={clearFinished} className="w-full rounded-xl bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-200">
            Clear Completed / Cancelled
          </button>
        </div>
      </aside>
    </>
  );
}
