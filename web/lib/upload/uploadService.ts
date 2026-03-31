import { API_URL } from '../urls';

type Json = Record<string, any>;

const uploadBase = `${API_URL}/upload`;

const toError = async (res: Response) => {
  const payload = await res.json().catch(() => ({}));
  const msg = String(payload?.error || payload?.message || `Upload request failed (${res.status})`);
  const err = new Error(msg) as Error & { status?: number; payload?: Json };
  err.status = res.status;
  err.payload = payload;
  return err;
};

const postJson = async <T>(path: string, body: Json): Promise<T> => {
  const res = await fetch(`${uploadBase}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await toError(res);
  return res.json() as Promise<T>;
};

export const uploadService = {
  initUpload: (input: {
    originalname: string;
    size: number;
    mimetype: string;
    chunk_size_bytes: number;
    upload_mode: 'chunk';
    hash?: string;
    partial_hash?: string;
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

    const res = await fetch(`${uploadBase}/chunk`, {
      method: 'POST',
      body: form,
      credentials: 'include',
      signal: input.signal,
    });
    if (!res.ok) throw await toError(res);
    return res.json();
  },

  completeUpload: (uploadId: string) => postJson<any>('/complete', { uploadId }),
  pauseUpload: (uploadId: string) => postJson<any>('/pause', { uploadId }),
  resumeUpload: (uploadId: string) => postJson<any>('/resume', { uploadId }),
  cancelUpload: (uploadId: string) => postJson<any>('/cancel', { uploadId }),

  getUploadStatus: async (uploadId: string) => {
    const encoded = encodeURIComponent(uploadId);
    const res = await fetch(`${uploadBase}/status/${encoded}`, {
      method: 'GET',
      credentials: 'include',
    });
    if (!res.ok) throw await toError(res);
    return res.json();
  },
};
