'use client';

import { useCallback, useRef, useState } from 'react';
import {
  ChevronDown,
  ChevronUp,
  Upload,
  Pause,
  Play,
  X,
  RotateCcw,
  Trash2,
  CheckCircle2,
  AlertCircle,
  Clock,
  Activity,
  File,
} from 'lucide-react';
import { useProductionUpload } from '@/hooks/useProductionUpload';
import type { UploadTask } from '@/lib/upload/production-types';

const formatBytes = (bytes: number): string => {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(i === 0 ? 0 : 1)} ${sizes[i]}`;
};

const formatSpeed = (bps: number): string => {
  return `${(bps / (1024 * 1024)).toFixed(1)} MB/s`;
};

const formatEta = (seconds: number): string => {
  if (!Number.isFinite(seconds) || seconds <= 0) return 'Calculating...';
  const s = Math.round(seconds);
  const min = Math.floor(s / 60);
  const sec = s % 60;
  if (min === 0) return `${sec}s`;
  if (min < 60) return `${min}m ${sec}s`;
  const hours = Math.floor(min / 60);
  return `${hours}h ${min % 60}m`;
};

const getStatusColor = (status: UploadTask['status']): string => {
  switch (status) {
    case 'completed':
      return 'text-green-600';
    case 'failed':
      return 'text-red-600';
    case 'paused':
      return 'text-amber-600';
    case 'uploading':
      return 'text-blue-600';
    case 'retrying':
      return 'text-orange-600';
    default:
      return 'text-gray-600';
  }
};

const getProgressBarColor = (status: UploadTask['status']): string => {
  switch (status) {
    case 'completed':
      return 'bg-green-500';
    case 'failed':
      return 'bg-red-500';
    case 'paused':
      return 'bg-amber-500';
    case 'uploading':
      return 'bg-blue-500';
    case 'retrying':
      return 'bg-orange-500';
    default:
      return 'bg-gray-400';
  }
};

const getStatusLabel = (status: UploadTask['status']): string => {
  const labels: Record<UploadTask['status'], string> = {
    queued: 'Queued',
    uploading: 'Uploading',
    paused: 'Paused',
    completed: 'Completed',
    failed: 'Failed',
    cancelled: 'Cancelled',
    retrying: 'Retrying',
  };
  return labels[status] || status;
};

const getStatusIcon = (status: UploadTask['status']) => {
  switch (status) {
    case 'completed':
      return <CheckCircle2 className={`w-5 h-5 ${getStatusColor(status)}`} />;
    case 'failed':
      return <AlertCircle className={`w-5 h-5 ${getStatusColor(status)}`} />;
    case 'uploading':
      return <Activity className={`w-5 h-5 ${getStatusColor(status)} animate-pulse`} />;
    case 'paused':
      return <Clock className={`w-5 h-5 ${getStatusColor(status)}`} />;
    default:
      return <File className={`w-5 h-5 ${getStatusColor(status)}`} />;
  }
};

interface ProductionUploaderProps {
  folderId?: number;
  telegramChatId?: string;
  onFilesAdded?: (count: number) => void;
}

export function ProductionUploader({
  folderId,
  telegramChatId,
  onFilesAdded,
}: ProductionUploaderProps) {
  const { tasks, stats, addFiles, pauseTask, resumeTask, cancelTask, retryTask, clearCompleted } =
    useProductionUpload({
      maxConcurrent: 3,
      maxRetries: 3,
      apiUrl: process.env.NEXT_PUBLIC_API_URL,
    });

  const [isExpanded, setIsExpanded] = useState(true);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(e.type === 'dragenter' || e.type === 'dragover');
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDragActive(false);

      const files = Array.from(e.dataTransfer.files);
      if (files.length > 0) {
        addFiles(files, { folderId, telegramChatId });
        onFilesAdded?.(files.length);
      }
    },
    [addFiles, folderId, telegramChatId, onFilesAdded]
  );

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files || []);
      if (files.length > 0) {
        addFiles(files, { folderId, telegramChatId });
        onFilesAdded?.(files.length);
      }
    },
    [addFiles, folderId, telegramChatId, onFilesAdded]
  );

  const handleClickUpload = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const hasFailedTasks = stats.failed > 0;
  const hasPausedTasks = stats.paused > 0;
  const hasCompletedTasks = stats.completed > 0;
  const isProcessing = stats.uploading > 0 || stats.queued > 0;

  return (
    <div className="fixed bottom-4 right-4 w-96 max-w-[calc(100vw-32px)] bg-white rounded-lg shadow-lg border border-gray-200 z-50">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-gray-200 cursor-pointer hover:bg-gray-50"
        onClick={() => setIsExpanded(!isExpanded)}>
        <div className="flex items-center gap-3">
          <Upload className="w-5 h-5 text-blue-600" />
          <div>
            <h3 className="font-semibold text-gray-900">Uploads</h3>
            <p className="text-xs text-gray-500">
              {stats.completed} of {stats.totalFiles} complete
            </p>
          </div>
        </div>
        <button className="p-1 hover:bg-gray-100 rounded">
          {isExpanded ? (
            <ChevronDown className="w-5 h-5" />
          ) : (
            <ChevronUp className="w-5 h-5" />
          )}
        </button>
      </div>

      {/* Content */}
      {isExpanded && (
        <div className="flex flex-col">
          {/* Progress Bar */}
          {isProcessing && (
            <div className="px-4 pt-4">
              <div className="flex justify-between items-center mb-2">
                <span className="text-xs font-medium text-gray-700">
                  {stats.overallProgress}%
                </span>
                {stats.avgSpeed > 0 && (
                  <span className="text-xs text-gray-500">
                    {formatSpeed(stats.avgSpeed)}
                  </span>
                )}
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div
                  className="bg-blue-500 h-2 rounded-full transition-all duration-300"
                  style={{ width: `${stats.overallProgress}%` }}
                />
              </div>
            </div>
          )}

          {/* Summary Stats */}
          {stats.totalFiles > 0 && (
            <div className="px-4 py-3 border-b border-gray-100 bg-gray-50">
              <div className="grid grid-cols-2 gap-4 text-xs">
                <div>
                  <span className="text-gray-500">Uploaded</span>
                  <p className="font-semibold text-gray-900">
                    {formatBytes(stats.uploadedBytes)} / {formatBytes(stats.totalBytes)}
                  </p>
                </div>
                <div>
                  <span className="text-gray-500">Speed</span>
                  <p className="font-semibold text-gray-900">
                    {formatSpeed(stats.avgSpeed)}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Drop Zone (if no tasks) */}
          {tasks.length === 0 && (
            <div
              className={`p-6 text-center border-b border-gray-200 transition-colors ${
                dragActive ? 'bg-blue-50 border-blue-300' : 'bg-gray-50'
              }`}
              onDragEnter={handleDrag}
              onDragLeave={handleDrag}
              onDragOver={handleDrag}
              onDrop={handleDrop}
            >
              <Upload className="w-8 h-8 text-gray-400 mx-auto mb-2" />
              <p className="text-sm font-medium text-gray-700 mb-1">
                Drop files to upload
              </p>
              <p className="text-xs text-gray-500 mb-3">
                or{' '}
                <button
                  onClick={handleClickUpload}
                  className="text-blue-600 hover:underline font-medium"
                >
                  click to browse
                </button>
              </p>
            </div>
          )}

          {/* Task List */}
          {tasks.length > 0 && (
            <div className="max-h-96 overflow-y-auto divide-y divide-gray-100">
              {tasks.map((task) => (
                <div
                  key={task.id}
                  className="p-3 hover:bg-gray-50 transition-colors"
                >
                  <div className="flex items-start gap-3 mb-2">
                    {getStatusIcon(task.status)}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">
                        {task.name}
                      </p>
                      <div className="flex items-center gap-2 mt-1 text-xs text-gray-500">
                        <span>{formatBytes(task.size)}</span>
                        <span className={`font-medium ${getStatusColor(task.status)}`}>
                          {getStatusLabel(task.status)}
                        </span>
                        {task.status === 'uploading' && task.speedBps > 0 && (
                          <>
                            <span>•</span>
                            <span>{formatSpeed(task.speedBps)}</span>
                            <span>•</span>
                            <span>{formatEta(task.etaSeconds)}</span>
                          </>
                        )}
                      </div>
                    </div>
                    {/* Action Buttons */}
                    <div className="flex gap-1">
                      {task.status === 'uploading' && (
                        <button
                          onClick={() => pauseTask(task.id)}
                          className="p-1 hover:bg-gray-200 rounded transition-colors"
                          title="Pause"
                        >
                          <Pause className="w-4 h-4 text-gray-600" />
                        </button>
                      )}
                      {task.status === 'paused' && (
                        <button
                          onClick={() => resumeTask(task.id)}
                          className="p-1 hover:bg-gray-200 rounded transition-colors"
                          title="Resume"
                        >
                          <Play className="w-4 h-4 text-gray-600" />
                        </button>
                      )}
                      {task.status === 'failed' && (
                        <button
                          onClick={() => retryTask(task.id)}
                          className="p-1 hover:bg-gray-200 rounded transition-colors"
                          title="Retry"
                        >
                          <RotateCcw className="w-4 h-4 text-gray-600" />
                        </button>
                      )}
                      {task.status !== 'completed' && task.status !== 'cancelled' && (
                        <button
                          onClick={() => cancelTask(task.id)}
                          className="p-1 hover:bg-gray-200 rounded transition-colors"
                          title="Cancel"
                        >
                          <X className="w-4 h-4 text-gray-600" />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Progress Bar */}
                  {task.status !== 'completed' && task.status !== 'cancelled' && (
                    <div className="w-full bg-gray-200 rounded-full h-1.5 overflow-hidden">
                      <div
                        className={`h-1.5 rounded-full transition-all duration-300 ${getProgressBarColor(
                          task.status
                        )}`}
                        style={{ width: `${task.progress}%` }}
                      />
                    </div>
                  )}

                  {/* Error Message */}
                  {task.error && (
                    <p className="text-xs text-red-600 mt-2">{task.error}</p>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Footer Actions */}
          {tasks.length > 0 && (
            <div className="px-4 py-3 border-t border-gray-200 bg-gray-50 flex gap-2">
              <button
                onClick={handleClickUpload}
                className="flex-1 px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded hover:bg-gray-50 transition-colors flex items-center justify-center gap-2"
              >
                <Upload className="w-4 h-4" />
                Add Files
              </button>
              {hasCompletedTasks && (
                <button
                  onClick={clearCompleted}
                  className="flex-1 px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded hover:bg-gray-50 transition-colors flex items-center justify-center gap-2"
                >
                  <Trash2 className="w-4 h-4" />
                  Clear
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* Hidden File Input */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        onChange={handleFileSelect}
        className="hidden"
      />
    </div>
  );
}
