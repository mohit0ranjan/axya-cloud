'use client';

import React from 'react';

type FileRow = {
  id: string;
  file_name: string;
  file_size: number;
  download_url: string | null;
};

type FolderRow = { name: string; path: string };

type SharedFolderViewProps = {
  title: string;
  folderPath: string;
  folders: FolderRow[];
  files: FileRow[];
  allowUpload: boolean;
  allowDownload: boolean;
  loading: boolean;
  error: string;
  apiBase: string;
  onUp: () => void;
  onOpenFolder: (path: string) => void;
  onUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
};

export default function SharedFolderView({
  title,
  folderPath,
  folders,
  files,
  allowUpload,
  allowDownload,
  loading,
  error,
  apiBase,
  onUp,
  onOpenFolder,
  onUpload,
}: SharedFolderViewProps) {
  return (
    <section style={styles.shell}>
      <div style={styles.panel}>
        <div style={styles.header}>
          <p style={styles.brand}>AYXA</p>
          <h1 style={styles.title}>{title}</h1>
          <p style={styles.path}>Path: {folderPath}</p>
        </div>

        {allowUpload && (
          <label style={styles.upload}>
            Upload
            <input type="file" style={{ display: 'none' }} onChange={onUpload} />
          </label>
        )}

        {!!error && <p style={styles.error}>{error}</p>}
        {loading && <p style={styles.note}>Loading...</p>}

        <div style={{ marginTop: 12, display: 'grid', gap: 10 }}>
          {folderPath !== '/' && (
            <button style={styles.row} onClick={onUp}>
              .. (Go up)
            </button>
          )}

          {folders.map((folder) => (
            <button key={folder.path} style={styles.row} onClick={() => onOpenFolder(folder.path)}>
              <span>Folder: {folder.name}</span>
            </button>
          ))}

          {files.map((file) => (
            <div key={file.id} style={styles.row}>
              <span style={{ flex: 1 }}>{file.file_name}</span>
              {allowDownload && file.download_url && (
                <a href={`${apiBase}${file.download_url}`} style={styles.download}>
                  Download
                </a>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

const styles: Record<string, React.CSSProperties> = {
  shell: {
    minHeight: '100vh',
    display: 'grid',
    placeItems: 'center',
    padding: 20,
    background:
      'radial-gradient(1200px 550px at 90% -10%, rgba(109,167,255,0.2), transparent 60%), radial-gradient(900px 550px at -10% 110%, rgba(59,130,246,0.18), transparent 60%), linear-gradient(140deg, #02050d, #071325 45%, #0e2445)',
  },
  panel: {
    width: 'min(940px, 100%)',
    borderRadius: 24,
    border: '1px solid rgba(255,255,255,0.16)',
    background: 'rgba(255,255,255,0.08)',
    backdropFilter: 'blur(18px)',
    boxShadow: '0 25px 60px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.1)',
    padding: 24,
    color: '#fff',
  },
  header: { marginBottom: 10 },
  brand: { margin: 0, fontWeight: 800, letterSpacing: '0.15em', color: '#dbe8ff' },
  title: { margin: '6px 0 0', fontSize: 28 },
  path: { margin: '6px 0 0', color: 'rgba(219,232,255,0.8)', fontSize: 13 },
  upload: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    height: 40,
    borderRadius: 12,
    padding: '0 14px',
    background: 'linear-gradient(135deg,#86b8ff,#5a95ff)',
    color: '#03122a',
    fontWeight: 700,
    cursor: 'pointer',
  },
  row: {
    minHeight: 44,
    borderRadius: 12,
    border: '1px solid rgba(255,255,255,0.16)',
    background: 'rgba(0,0,0,0.26)',
    color: '#fff',
    padding: '0 12px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    textAlign: 'left',
    cursor: 'pointer',
  },
  download: { color: '#9cc4ff', fontWeight: 700, textDecoration: 'none' },
  error: { color: '#ffb0b0', marginTop: 8 },
  note: { color: 'rgba(219,232,255,0.8)', marginTop: 8 },
};
