import { api } from '../api';

type Json = Record<string, any>;
const postJson = <T>(path: string, body: Json): Promise<T> =>
  api<T>(`/upload${path}`, { method: 'POST', body: JSON.stringify(body) });
export const uploadService = {
  initUpload: (input: {
    originalname: string;
    size: number;
    mimetype: string;
    chunk_size_bytes: number;
    upload_mode: 'chunk';
    hash?: string;
    partial_hash?: string;
    folder_id?: string;
    telegram_chat_id?: string;
  }) => postJson<any>('/init', input),

  uploadChunk: async (input: {
    uploadId: string;
    chunkIndex: number;
    chunkBlob: Blob;
    signal?: AbortSignal;
  }) => {
    const form = new FormData();
    form.append('uploadId', input.uploadId);
    form.append('chunkIndex', String(input.chunkIndex));
    form.append('chunk', input.chunkBlob, `chunk-${input.chunkIndex}.bin`);

    return api('/upload/chunk', { method: 'POST', body: form, signal: input.signal }, 600000);
  },

  completeUpload: (uploadId: string) => postJson<any>('/complete', { uploadId }),
  pauseUpload: (uploadId: string) => postJson<any>('/pause', { uploadId }),
  resumeUpload: (uploadId: string) => postJson<any>('/resume', { uploadId }),
  cancelUpload: (uploadId: string) => postJson<any>('/cancel', { uploadId }),

  getUploadStatus: async (uploadId: string) => {
    const encoded = encodeURIComponent(uploadId);
    return api(`/upload/status/${encoded}`);
  },
};
