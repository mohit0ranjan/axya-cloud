'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

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

      if (!spaceRes.ok) throw new Error(spacePayload.error || 'Failed to load space');
      if (!filesRes.ok) {
        if (filesRes.status === 401) {
          setSpace(spacePayload.space);
          setFiles([]);
          setFolders([]);
          return;
        }
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

  const unlock = useCallback(async () => {
    setError('');
    const res = await fetch(`${API_BASE}/api/spaces/${spaceId}/validate-password`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    const payload = await res.json();
    if (!res.ok) {
      setError(payload.error || 'Invalid password');
      return;
    }
    setAccessToken(String(payload.access_token || ''));
    setPassword('');
  }, [password, spaceId]);

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

  const isLocked = Boolean(space?.requires_password && !space?.has_access && !accessToken);

  return (
    <main style={{ maxWidth: 900, margin: '0 auto', padding: 24 }}>
      <section style={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 16, padding: 20 }}>
        <h1 style={{ margin: 0, fontSize: 28 }}>{space?.name || 'Shared Space'}</h1>
        <p style={{ marginTop: 6, color: 'var(--muted)', fontSize: 13 }}>Path: {folderPath}</p>

        {isLocked && (
          <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter password"
              style={{ flex: 1, height: 40, borderRadius: 10, border: '1px solid var(--line)', padding: '0 10px' }}
            />
            <button onClick={() => void unlock()} style={buttonStyle}>Unlock</button>
          </div>
        )}

        {!isLocked && space?.allow_upload && (
          <div style={{ marginTop: 12 }}>
            <label style={buttonStyle}>
              Upload
              <input type="file" style={{ display: 'none' }} onChange={(e) => void upload(e)} />
            </label>
          </div>
        )}

        {!!error && <p style={{ color: '#d93025', marginTop: 12 }}>{error}</p>}
        {loading && <p style={{ marginTop: 12, color: 'var(--muted)' }}>Loading...</p>}

        {!isLocked && (
          <div style={{ marginTop: 16, display: 'grid', gap: 10 }}>
            {folderPath !== '/' && (
              <button style={rowStyle} onClick={() => setFolderPath(folderPath.split('/').slice(0, -1).join('/') || '/')}>
                .. (Go up)
              </button>
            )}

            {folders.map((folder) => (
              <button key={folder.path} style={rowStyle} onClick={() => setFolderPath(folder.path)}>
                📁 {folder.name}
              </button>
            ))}
            {files.map((file) => (
              <div key={file.id} style={rowStyle}>
                <span style={{ flex: 1 }}>📄 {file.file_name}</span>
                {space?.allow_download && file.download_url && (
                  <a href={`${API_BASE}${file.download_url}`} style={{ color: 'var(--primary)', fontWeight: 700 }}>Download</a>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}

const buttonStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 8,
  border: 0,
  height: 40,
  borderRadius: 10,
  padding: '0 14px',
  cursor: 'pointer',
  background: 'var(--primary)',
  color: '#fff',
  fontWeight: 700,
};

const rowStyle: React.CSSProperties = {
  minHeight: 44,
  borderRadius: 10,
  border: '1px solid var(--line)',
  background: '#fff',
  padding: '0 12px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  textAlign: 'left',
};
