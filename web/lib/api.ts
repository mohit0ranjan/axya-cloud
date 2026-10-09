import { API_URL } from './urls';

export class ApiError extends Error {
  constructor(message: string, public status: number, public code?: string, public payload?: any) { super(message); }
}
export async function api<T = any>(path: string, init: RequestInit = {}, timeoutMs = 60000): Promise<T> {
  const controller = new AbortController();
  const forwardAbort = () => controller.abort(init.signal?.reason);
  if (init.signal?.aborted) forwardAbort();
  else init.signal?.addEventListener('abort', forwardAbort, { once: true });
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${API_URL}${path}`, { ...init, credentials: 'include', signal: controller.signal,
      headers: { ...(init.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }), ...init.headers } });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.success === false) throw new ApiError(data.message || data.error || 'Request failed. Please retry.', response.status, data.code, data);
    return data as T;
  } finally { clearTimeout(timer); init.signal?.removeEventListener('abort', forwardAbort); }
}
export const mutate = <T = any>(path: string, body: unknown = {}, method = 'POST') => api<T>(path, { method, body: JSON.stringify(body) });
