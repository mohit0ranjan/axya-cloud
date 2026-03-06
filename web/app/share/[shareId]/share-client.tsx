'use client';

import type { Dispatch, SetStateAction } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import styles from './share.module.css';

type ShareMeta = {
  id: string;
  type: 'folder' | 'file';
  folderId?: string;
  fileId?: string;
  folderName: string;
  owner: string;
  fileCount: number;
  requiresPassword: boolean;
  hasAccess?: boolean;
  allowDownload: boolean;
  viewOnly: boolean;
  dateShared: string;
  expiresAt: string | null;
};

type FolderItem = {
  id: string;
  name: string;
  path: string;
  fileCount: number;
  imageCount: number;
};

type FileItem = {
  id: string;
  file_name: string;
  file_size: number;
  mime_type: string | null;
  created_at: string;
  relative_path?: string;
};

type SectionData = {
  path: string;
  breadcrumbs: Array<{ label: string; path: string }>;
  folders: FolderItem[];
  files: FileItem[];
  page: {
    offset: number;
    limit: number;
    total: number;
    hasMore: boolean;
  };
};

type SectionState = SectionData & {
  expanded: boolean;
  loading: boolean;
  error: string;
};

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:3000';
const PAGE_SIZE = 40;
const buildShareDownloadUrl = (fileId: string, disposition: 'attachment' | 'inline') =>
  `${API_BASE}/api/share/download/${encodeURIComponent(fileId)}?disposition=${disposition}`;

const formatDate = (value: string | null | undefined) =>
  value
    ? new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : 'No expiry';

const formatSize = (bytes: number) => {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const order = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / 1024 ** order).toFixed(order === 0 ? 0 : 1)} ${units[order]}`;
};

const isImage = (file: FileItem) => (file.mime_type || '').startsWith('image/');
const isVideo = (file: FileItem) => (file.mime_type || '').startsWith('video/');
const mimeLabel = (file: FileItem) => {
  const mime = file.mime_type || '';
  if (!mime) return 'File';
  if (mime.startsWith('image/')) return 'Image';
  if (mime.startsWith('video/')) return 'Video';
  if (mime.startsWith('audio/')) return 'Audio';
  if (mime === 'application/pdf') return 'PDF';
  return mime.split('/')[1]?.toUpperCase() || 'File';
};

export default function ShareClient({ shareId }: { shareId: string }) {
  const searchParams = useSearchParams();
  const queryToken = searchParams.get('token') || '';
  const legacyTokenPayload = useMemo(() => {
    if (queryToken || !shareId || shareId.split('.').length !== 3) return null;
    try {
      const payloadSegment = shareId.split('.')[1] || '';
      const base64 = payloadSegment.replace(/-/g, '+').replace(/_/g, '/');
      const normalized = base64 + '='.repeat((4 - (base64.length % 4 || 4)) % 4);
      const decoded = atob(normalized);
      const payload = JSON.parse(decoded) as { typ?: string; shareId?: string };
      if (payload?.typ !== 'share_link' || !payload?.shareId) return null;
      return { shareId: String(payload.shareId), token: shareId };
    } catch {
      return null;
    }
  }, [queryToken, shareId]);
  const resolvedShareId = legacyTokenPayload?.shareId || shareId;
  const signedToken = queryToken || legacyTokenPayload?.token || '';

  const [share, setShare] = useState<ShareMeta | null>(null);
  const [accessToken, setAccessToken] = useState('');
  const [password, setPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [loadingSession, setLoadingSession] = useState(true);
  const [verifyingPassword, setVerifyingPassword] = useState(false);
  const [searchInput, setSearchInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<'name' | 'date'>('name');
  const [order, setOrder] = useState<'asc' | 'desc'>('asc');
  const [sections, setSections] = useState<Record<string, SectionState>>({});
  const [downloadingFileId, setDownloadingFileId] = useState('');

  useEffect(() => {
    const handle = window.setTimeout(() => setSearchQuery(searchInput.trim()), 250);
    return () => window.clearTimeout(handle);
  }, [searchInput]);

  useEffect(() => {
    let active = true;

    const loadSession = async () => {
      setLoadingSession(true);
      setPasswordError('');

      try {
        const res = await fetch(`${API_BASE}/api/share/${resolvedShareId}?token=${encodeURIComponent(signedToken)}`);
        const payload = await res.json().catch(() => ({}));

        if (!res.ok) {
          if (!active) return;
          setShare(null);
          setPasswordError(payload.error || 'Unable to open this share.');
          return;
        }

        if (!active) return;

        setShare(payload.share || null);
        setAccessToken(String(payload.accessToken || ''));
        if (payload.accessToken) {
          setSections({});
        }
      } catch {
        if (active) setPasswordError('Unable to reach the share service.');
      } finally {
        if (active) setLoadingSession(false);
      }
    };

    void loadSession();
    return () => {
      active = false;
    };
  }, [resolvedShareId, signedToken]);

  useEffect(() => {
    if (!accessToken) return;
    setSections({});
    void loadSection('/', true);
  }, [accessToken, searchQuery, sortBy, order]);

  const loadSection = async (path: string, reset: boolean) => {
    const sectionKey = path;
    setSections((current) => ({
      ...current,
      [sectionKey]: {
        path,
        breadcrumbs: current[sectionKey]?.breadcrumbs || [{ label: 'Root', path: '/' }],
        folders: reset ? [] : current[sectionKey]?.folders || [],
        files: reset ? [] : current[sectionKey]?.files || [],
        page: current[sectionKey]?.page || { offset: 0, limit: PAGE_SIZE, total: 0, hasMore: false },
        expanded: current[sectionKey]?.expanded ?? true,
        loading: true,
        error: '',
      },
    }));

    try {
      const currentOffset = reset ? 0 : sections[sectionKey]?.files.length || 0;
      const params = new URLSearchParams({
        path,
        limit: String(PAGE_SIZE),
        offset: String(currentOffset),
        sortBy,
        order,
      });
      if (searchQuery) params.set('search', searchQuery);

      const res = await fetch(`${API_BASE}/api/share/files?${params.toString()}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const payload = await res.json().catch(() => ({}));

      if (!res.ok) {
        setSections((current) => ({
          ...current,
          [sectionKey]: {
            ...(current[sectionKey] || {
              path,
              breadcrumbs: [{ label: 'Root', path: '/' }],
              folders: [],
              files: [],
              page: { offset: 0, limit: PAGE_SIZE, total: 0, hasMore: false },
              expanded: true,
            }),
            loading: false,
            error: payload.error || 'Unable to load files.',
          },
        }));
        return;
      }

      if (payload.share) setShare(payload.share);

      setSections((current) => {
        const previous = current[sectionKey];
        const mergedFiles = reset ? payload.files || [] : [...(previous?.files || []), ...(payload.files || [])];
        return {
          ...current,
          [sectionKey]: {
            path: payload.path || path,
            breadcrumbs: payload.breadcrumbs || [{ label: 'Root', path: '/' }],
            folders: payload.folders || [],
            files: mergedFiles,
            page: payload.page || { offset: 0, limit: PAGE_SIZE, total: mergedFiles.length, hasMore: false },
            expanded: previous?.expanded ?? true,
            loading: false,
            error: '',
          },
        };
      });
    } catch {
      setSections((current) => ({
        ...current,
        [sectionKey]: {
          ...(current[sectionKey] || {
            path,
            breadcrumbs: [{ label: 'Root', path: '/' }],
            folders: [],
            files: [],
            page: { offset: 0, limit: PAGE_SIZE, total: 0, hasMore: false },
            expanded: true,
          }),
          loading: false,
          error: 'Network error while loading files.',
        },
      }));
    }
  };

  const handleUnlock = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!password.trim()) {
      setPasswordError('Enter the password first.');
      return;
    }

    setVerifyingPassword(true);
    setPasswordError('');
    try {
      const res = await fetch(`${API_BASE}/api/share/verify-password`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ shareId: resolvedShareId, password }),
      });
      const payload = await res.json().catch(() => ({}));

      if (!res.ok) {
        if (res.status === 401) setPasswordError('Incorrect password.');
        else if (res.status === 404) setPasswordError('Share not found.');
        else if (res.status === 410) setPasswordError('This link has expired.');
        else if (res.status === 429) setPasswordError('Too many attempts. Try again later.');
        else setPasswordError(payload.error || 'Unable to verify password.');
        return;
      }

      setAccessToken(String(payload.accessToken || ''));
      setPassword('');
      setShare((current) => (current ? { ...current, hasAccess: true } : current));
    } catch {
      setPasswordError('Unable to verify password.');
    } finally {
      setVerifyingPassword(false);
    }
  };

  const downloadFile = async (file: FileItem) => {
    if (!accessToken) return;
    setDownloadingFileId(file.id);
    try {
      const res = await fetch(buildShareDownloadUrl(file.id, 'attachment'), {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) return;
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = objectUrl;
      anchor.download = file.file_name || 'download';
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(objectUrl);
    } finally {
      setDownloadingFileId('');
    }
  };

  const rootSection = sections['/'];
  const ready = Boolean(accessToken && rootSection);
  const isLocked = Boolean(share?.requiresPassword && !accessToken);

  const stats = useMemo(
    () => [
      { label: 'Owner', value: share?.owner || 'AYXA User' },
      { label: 'Files', value: String(share?.fileCount || 0) },
      { label: 'Shared', value: formatDate(share?.dateShared) },
    ],
    [share]
  );

  if (loadingSession) {
    return <div className={styles.loadingShell}>Loading shared folder...</div>;
  }

  if (!share) {
    return <div className={styles.loadingShell}>{passwordError || 'Share not found.'}</div>;
  }

  if (isLocked) {
    return (
      <main className={styles.page}>
        <section className={styles.lockCard}>
          <div className={styles.logo}>AYXA</div>
          <h1 className={styles.lockTitle}>Shared Folder: {share.folderName}</h1>
          <p className={styles.lockText}>This shared folder is password protected.</p>
          <form onSubmit={handleUnlock} className={styles.passwordForm}>
            <input
              className={styles.passwordInput}
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Enter password"
              autoComplete="current-password"
            />
            <button className={styles.primaryButton} type="submit" disabled={verifyingPassword}>
              {verifyingPassword ? 'Unlocking...' : 'Unlock Folder'}
            </button>
          </form>
          {passwordError ? <p className={styles.errorText}>{passwordError}</p> : null}
        </section>
      </main>
    );
  }

  return (
    <main className={styles.page}>
      <header className={styles.topBar}>
        <div>
          <div className={styles.logo}>AYXA</div>
          <h1 className={styles.pageTitle}>Shared Folder: {share.folderName}</h1>
        </div>
      </header>

      <section className={styles.infoCard}>
        <div className={styles.infoGrid}>
          {stats.map((item) => (
            <div key={item.label} className={styles.infoStat}>
              <span className={styles.infoLabel}>{item.label}</span>
              <strong>{item.value}</strong>
            </div>
          ))}
        </div>
        <div className={styles.infoAside}>
          <span className={styles.infoBadge}>{share.viewOnly ? 'View Only' : share.allowDownload ? 'Download Enabled' : 'Preview Only'}</span>
          <span className={styles.infoExpiry}>Expires: {formatDate(share.expiresAt)}</span>
        </div>
      </section>

      {share.type !== 'file' ? (
        <section className={styles.toolbar}>
          <input
            className={styles.searchInput}
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder="Search files"
          />
          <div className={styles.toolbarControls}>
            <select className={styles.select} value={sortBy} onChange={(event) => setSortBy(event.target.value as 'name' | 'date')}>
              <option value="name">Sort by name</option>
              <option value="date">Sort by date</option>
            </select>
            <button className={styles.secondaryButton} onClick={() => setOrder((current) => (current === 'asc' ? 'desc' : 'asc'))}>
              {order === 'asc' ? 'Ascending' : 'Descending'}
            </button>
            <span className={styles.fileCounter}>{share.fileCount} items</span>
          </div>
        </section>
      ) : null}

      {!ready ? (
        <div className={styles.loadingPanel}>Loading files...</div>
      ) : (
        <section className={styles.browser}>
          {rootSection.error ? <p className={styles.errorText}>{rootSection.error}</p> : null}
          {searchQuery ? (
            <SectionFiles
              title={`Search Results${rootSection.page.total ? ` (${rootSection.page.total})` : ''}`}
              files={rootSection.files}
              page={rootSection.page}
              onLoadMore={() => void loadSection('/', false)}
              accessToken={accessToken}
              onDownloadFile={downloadFile}
              downloadingFileId={downloadingFileId}
            />
          ) : (
            <>
              {share.type === 'file' ? (
                <SingleFilePanel
                  file={rootSection.files[0]}
                  share={share}
                  accessToken={accessToken}
                  onDownloadFile={downloadFile}
                  downloadingFileId={downloadingFileId}
                />
              ) : null}

              {share.type === 'folder' && rootSection.folders.length === 0 && rootSection.files.length === 0 ? (
                <div className={styles.emptyState}>This folder is empty.</div>
              ) : null}

              {share.type === 'folder' &&
                rootSection.folders.map((folder) => (
                  <FolderSection
                    key={folder.path}
                    folder={folder}
                    sections={sections}
                    setSections={setSections}
                    loadSection={loadSection}
                    accessToken={accessToken}
                    onDownloadFile={downloadFile}
                    downloadingFileId={downloadingFileId}
                  />
                ))}

              {share.type === 'folder' && rootSection.files.length > 0 ? (
                <SectionFiles
                  title="Files in Root"
                  files={rootSection.files}
                  page={rootSection.page}
                  onLoadMore={() => void loadSection('/', false)}
                  accessToken={accessToken}
                  onDownloadFile={downloadFile}
                  downloadingFileId={downloadingFileId}
                />
              ) : null}
            </>
          )}
        </section>
      )}
    </main>
  );
}

function FolderSection({
  folder,
  sections,
  setSections,
  loadSection,
  accessToken,
  onDownloadFile,
  downloadingFileId,
}: {
  folder: FolderItem;
  sections: Record<string, SectionState>;
  setSections: Dispatch<SetStateAction<Record<string, SectionState>>>;
  loadSection: (path: string, reset: boolean) => Promise<void>;
  accessToken: string;
  onDownloadFile: (file: FileItem) => Promise<void>;
  downloadingFileId: string;
}) {
  const section = sections[folder.path];
  const expanded = section?.expanded ?? false;
  const toggleSection = () => {
    const isExpanded = sections[folder.path]?.expanded ?? false;
    setSections((current) => ({
      ...current,
      [folder.path]: current[folder.path]
        ? { ...current[folder.path], expanded: !isExpanded }
        : {
            path: folder.path,
            breadcrumbs: [{ label: 'Root', path: '/' }],
            folders: [],
            files: [],
            page: { offset: 0, limit: PAGE_SIZE, total: 0, hasMore: false },
            expanded: true,
            loading: false,
            error: '',
          },
    }));

    if (!isExpanded && !sections[folder.path]) {
      void loadSection(folder.path, true);
    }
  };

  return (
    <article className={styles.folderCard}>
      <button className={styles.folderHeader} onClick={toggleSection}>
        <div>
          <strong>{folder.name}</strong>
          <p className={styles.folderMeta}>
            {folder.fileCount} files • {folder.imageCount} images
          </p>
        </div>
        <span className={styles.expandIcon}>{expanded ? '−' : '+'}</span>
      </button>

      <div className={`${styles.folderBody} ${expanded ? styles.folderBodyExpanded : ''}`}>
        <div className={styles.folderInner}>
          {section?.loading ? <div className={styles.loadingRow}>Loading...</div> : null}
          {section?.error ? <p className={styles.errorText}>{section.error}</p> : null}
          {section?.folders.map((child) => (
            <FolderSection
              key={child.path}
              folder={child}
              sections={sections}
              setSections={setSections}
              loadSection={loadSection}
              accessToken={accessToken}
              onDownloadFile={onDownloadFile}
              downloadingFileId={downloadingFileId}
            />
          ))}
          {section ? (
            <SectionFiles
              title="Contents"
              files={section.files}
              page={section.page}
              onLoadMore={() => void loadSection(folder.path, false)}
              accessToken={accessToken}
              onDownloadFile={onDownloadFile}
              downloadingFileId={downloadingFileId}
            />
          ) : null}
        </div>
      </div>
    </article>
  );
}

function SectionFiles({
  title,
  files,
  page,
  onLoadMore,
  accessToken,
  onDownloadFile,
  downloadingFileId,
}: {
  title: string;
  files: FileItem[];
  page: { total: number; hasMore: boolean };
  onLoadMore: () => void;
  accessToken: string;
  onDownloadFile: (file: FileItem) => Promise<void>;
  downloadingFileId: string;
}) {
  const imageFiles = files.filter(isImage);
  const listFiles = files.filter((file) => !isImage(file));

  return (
    <section className={styles.filesBlock}>
      <div className={styles.blockHeader}>
        <h2>{title}</h2>
        <span>{page.total} items</span>
      </div>

      {imageFiles.length > 0 ? (
        <div className={styles.galleryGrid}>
          {imageFiles.map((file) => (
            <article key={file.id} className={styles.imageCard}>
              <ProtectedImage className={styles.imagePreview} fileId={file.id} fileName={file.file_name} accessToken={accessToken} />
              <div className={styles.fileFooter}>
                <strong>{file.file_name}</strong>
                <span>{formatSize(file.file_size)}</span>
              </div>
              <button className={styles.downloadLink} type="button" onClick={() => void onDownloadFile(file)} disabled={downloadingFileId === file.id}>
                {downloadingFileId === file.id ? 'Downloading...' : 'Download'}
              </button>
            </article>
          ))}
        </div>
      ) : null}

      {listFiles.length > 0 ? (
        <div className={styles.fileList}>
          {listFiles.map((file) => (
            <article key={file.id} className={styles.fileRow}>
              <div>
                <strong>{file.file_name}</strong>
                <p>
                  {formatSize(file.file_size)} • {formatDate(file.created_at)}
                </p>
              </div>
              <button className={styles.downloadLink} type="button" onClick={() => void onDownloadFile(file)} disabled={downloadingFileId === file.id}>
                {downloadingFileId === file.id ? 'Downloading...' : 'Download'}
              </button>
            </article>
          ))}
        </div>
      ) : null}

      {files.length === 0 ? <div className={styles.emptyState}>No files in this section.</div> : null}

      {page.hasMore ? (
        <button className={styles.loadMoreButton} onClick={onLoadMore}>
          Load more
        </button>
      ) : null}
    </section>
  );
}

function SingleFilePanel({
  file,
  share,
  accessToken,
  onDownloadFile,
  downloadingFileId,
}: {
  file: FileItem | undefined;
  share: ShareMeta;
  accessToken: string;
  onDownloadFile: (file: FileItem) => Promise<void>;
  downloadingFileId: string;
}) {
  if (!file) {
    return <div className={styles.loadingPanel}>Loading shared file...</div>;
  }

  return (
    <section className={styles.singleFileShell}>
      <div className={styles.singleFileHeader}>
        <div>
          <p className={styles.singleFileType}>{mimeLabel(file)}</p>
          <h2>{file.file_name}</h2>
          <p className={styles.singleFileMeta}>
            {formatSize(file.file_size)} • Shared by {share.owner} • {formatDate(file.created_at)}
          </p>
        </div>
        <button className={styles.singleFileDownload} type="button" onClick={() => void onDownloadFile(file)} disabled={downloadingFileId === file.id}>
          {downloadingFileId === file.id ? 'Downloading...' : 'Download File'}
        </button>
      </div>

      <div className={styles.singlePreview}>
        {isImage(file) ? <ProtectedImage fileId={file.id} fileName={file.file_name} accessToken={accessToken} className={styles.singleImage} /> : null}
        {isVideo(file) ? <ProtectedVideo fileId={file.id} accessToken={accessToken} className={styles.singleVideo} mimeType={file.mime_type || 'video/mp4'} /> : null}
        {!isImage(file) && !isVideo(file) ? (
          <div className={styles.singleFallback}>
            <strong>{mimeLabel(file)}</strong>
            <p>This file can be downloaded directly.</p>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function useProtectedObjectUrl(fileId: string, accessToken: string, disposition: 'attachment' | 'inline' = 'inline') {
  const [objectUrl, setObjectUrl] = useState('');

  useEffect(() => {
    if (!fileId || !accessToken) {
      setObjectUrl('');
      return;
    }

    let active = true;
    let createdUrl = '';
    const abort = new AbortController();

    const load = async () => {
      try {
        const res = await fetch(buildShareDownloadUrl(fileId, disposition), {
          headers: { Authorization: `Bearer ${accessToken}` },
          signal: abort.signal,
        });
        if (!res.ok) return;
        const blob = await res.blob();
        createdUrl = URL.createObjectURL(blob);
        if (active) {
          setObjectUrl(createdUrl);
        } else {
          URL.revokeObjectURL(createdUrl);
        }
      } catch {
        if (active) setObjectUrl('');
      }
    };

    void load();
    return () => {
      active = false;
      abort.abort();
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [accessToken, disposition, fileId]);

  return objectUrl;
}

function ProtectedImage({
  fileId,
  fileName,
  accessToken,
  className,
}: {
  fileId: string;
  fileName: string;
  accessToken: string;
  className: string;
}) {
  const src = useProtectedObjectUrl(fileId, accessToken, 'inline');
  if (!src) {
    return <div className={className} aria-label={`Loading ${fileName}`} />;
  }
  return <img className={className} src={src} alt={fileName} loading="lazy" />;
}

function ProtectedVideo({
  fileId,
  accessToken,
  className,
  mimeType,
}: {
  fileId: string;
  accessToken: string;
  className: string;
  mimeType: string;
}) {
  const src = useProtectedObjectUrl(fileId, accessToken, 'inline');
  if (!src) return <div className={className} />;
  return (
    <video controls className={className}>
      <source src={src} type={mimeType} />
    </video>
  );
}
