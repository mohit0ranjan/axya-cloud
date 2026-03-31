export type UploadStatus =
  | 'queued'
  | 'uploading'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'waiting_connection';

export type UploadTask = {
  id: string;
  file: File;
  name: string;
  size: number;
  type?: string;
  status: UploadStatus;
  progress: number;
  uploadedBytes: number;
  speedBps: number;
  etaSeconds: number;
  createdAt: number;
  error?: string;
  previewUrl?: string;
  showSkeletonUntil?: number;
  uploadId?: string;
  uploadedChunks?: number[];
  totalChunks?: number;
  chunkSizeBytes?: number;
};

export type UploadStats = {
  totalFiles?: number;
  active?: number;
  uploading: number;
  queued: number;
  failed: number;
  paused: number;
  completed: number;
  totalBytes?: number;
  uploadedBytes?: number;
  avgSpeed: number;
};
