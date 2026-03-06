'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import SharePage from './share-page';

type Space = {
  id: string;
  name: string;
  allow_upload: boolean;
  allow_download: boolean;
  expires_at: string | null;
  requires_password?: boolean;
  has_access?: boolean;
};

type FileRow = {
  id: string;
  file_name: string;
  file_size: number;
  mime_type: string | null;
  folder_path: string;
  download_url: string | null;
};

type FolderRow = { name: string; path: string };

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:3000';

export default function SharedSpaceClient({ spaceId }: { spaceId: string }) {
  const [space, setSpace] = useState<Space | null>(null);
  const [files, setFiles] = useState<FileRow[]>([]);
  const [folders, setFolders] = useState<FolderRow[]>([]);
  const [folderPath, setFolderPath] = useState('/');
  const [password, setPassword] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const headers = useMemo(() => (
    accessToken ? { 'x-space-access-token': accessToken } : undefined
  ), [accessToken]);

  const load = useCallback(async (nextPath: string) => {
    setLoading(true);
    setError('');
    try {
      const [spaceRes, filesRes] = await Promise.all([
        fetch(`${API_BASE}/api/spaces/${spaceId}`, { headers, credentials: 'include' }),
        fetch(`${API_BASE}/api/spaces/${spaceId}/files?folder_path=${encodeURIComponent(nextPath)}`, { headers, credentials: 'include' }),
      ]);
      const spacePayload = await spaceRes.json();
      const filesPayload = await filesRes.json();

      if (!spaceRes.ok) {
        if (spaceRes.status === 404) throw new Error('Share not found.');
        if (spaceRes.status === 410) throw new Error('Link expired.');
        throw new Error(spacePayload.error || 'Failed to load shared space');
      }

      if (!filesRes.ok) {
        if (filesRes.status === 401) {
          setSpace(spacePayload.space);
          setFiles([]);
          setFolders([]);
          return;
        }
        if (filesRes.status === 404) throw new Error('Share not found.');
        if (filesRes.status === 410) throw new Error('Link expired.');
        throw new Error(filesPayload.error || 'Failed to load files');
      }

      setSpace(filesPayload.space || spacePayload.space);
      setFiles(filesPayload.files || []);
      setFolders(filesPayload.folders || []);
    } catch (e: any) {
      setError(e.message || 'Failed to load shared space');
    } finally {
      setLoading(false);
    }
  }, [headers, spaceId]);

  useEffect(() => {
    void load(folderPath);
  }, [folderPath, load]);

  const unlock = useCallback(async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!password.trim()) {
      setError('Please enter the password.');
      return;
    }

    setError('');
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/spaces/${spaceId}/validate-password`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 401) setError('Incorrect password.');
        else if (res.status === 404) setError('Share not found.');
        else if (res.status === 410) setError('Link expired.');
        else if (res.status === 429) setError('Too many attempts. Try again later.');
        else setError(payload.error || 'Server error while verifying password.');
        return;
      }
      const token = String(payload.access_token || '');
      setAccessToken(token);
      setSpace((prev) => (prev ? { ...prev, has_access: true } : prev));
      setPassword('');
      await load(folderPath);
    } catch (err: any) {
      setError(err?.message || 'Network error verifying password');
    } finally {
      setLoading(false);
    }
  }, [folderPath, load, password, spaceId]);

  const upload = useCallback(async (ev: React.ChangeEvent<HTMLInputElement>) => {
    const selected = ev.target.files?.[0];
    if (!selected) return;
    const form = new FormData();
    form.append('folder_path', folderPath);
    form.append('file', selected);

    const res = await fetch(`${API_BASE}/api/spaces/${spaceId}/upload`, {
      method: 'POST',
      body: form,
      headers,
      credentials: 'include',
    });
    const payload = await res.json();
    if (!res.ok) {
      setError(payload.error || 'Upload failed');
      return;
    }
    await load(folderPath);
  }, [folderPath, headers, load, spaceId]);

  return (
    <SharePage
      space={space}
      files={files}
      folders={folders}
      folderPath={folderPath}
      password={password}
      loading={loading}
      error={error}
      apiBase={API_BASE}
      onPasswordChange={setPassword}
      onUnlock={unlock}
      onUp={() => setFolderPath(folderPath.split('/').slice(0, -1).join('/') || '/')}
      onOpenFolder={setFolderPath}
      onUpload={(e) => void upload(e)}
    />
  );
}
