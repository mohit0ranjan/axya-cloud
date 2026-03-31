/**
 * Production Upload System Types
 * Shared types for frontend/backend communication
 */

export type UploadMode = 'simple' | 'chunk';

export type UploadTaskStatus =
  | 'queued'        // Waiting in queue
  | 'uploading'     // Currently uploading
  | 'paused'        // User paused
  | 'completed'     // Successfully completed
  | 'failed'        // Failed with error
  | 'cancelled'     // User cancelled
  | 'retrying';     // Retrying after failure

export interface UploadTask {
  id: string;
  file: File;
  name: string;
  size: number;
  type?: string;
  mimeType?: string;

  status: UploadTaskStatus;
  progress: number; // 0-100
  uploadedBytes: number;
  
  speedBps: number; // Bytes per second
  etaSeconds: number;
  
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  
  error?: string;
  errorCode?: string;
  retryCount: number;
  maxRetries: number;
  
  // Preview
  previewUrl?: string;
  
  // Abort controller for cancellation
  abortController: AbortController;
  
  // Metadata
  folderId?: number;
  telegramChatId?: string;
}

export interface UploadStats {
  totalFiles: number;
  totalBytes: number;
  
  queued: number;
  uploading: number;
  paused: number;
  completed: number;
  failed: number;
  cancelled: number;
  
  uploadedBytes: number;
  uploadedFiles: number;
  
  avgSpeed: number; // Bytes per second
  overallProgress: number; // 0-100
}

export interface UploadQueueConfig {
  maxConcurrent: number;
  maxRetries: number;
  retryDelayMs: number;
  chunkSize?: number; // For chunked uploads in future
  apiUrl: string;
}

export interface UploadResponse {
  success: boolean;
  uploadId?: string;
  fileName?: string;
  fileSize?: number;
  status?: UploadTaskStatus;
  message?: string;
  error?: string;
}

export interface UploadStatusResponse {
  uploadId: string;
  fileName: string;
  fileSize: number;
  status: UploadTaskStatus;
  createdAt: string;
  updatedAt: string;
  error?: string | null;
}
