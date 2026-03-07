'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import styles from './share-v2.module.css';

type ShareMeta = {
  id: string;
  slug: string;
  resourceType: 'file' | 'folder';
  allowDownload: boolean;
  allowPreview: boolean;
  requiresPassword: boolean;
  expiresAt: string | null;
  revokedAt: string | null;
  fileCount: number;
};

type SharedFolder = {
  name: string;
  path: string;
  fileCount: number;
};

type SharedFile = {
  id: string;
  display_name: string;
  size_bytes: number;
  mime_type: string | null;
  relative_path: string;
  created_at: string;
};

type SectionData = {
  path: string;
  folders: SharedFolder[];
  files: SharedFile[];
  page: {
    offset: number;
    limit: number;
    total: number;
    hasMore: boolean;
  };
  cursor?: {
    next: string | null;
    current: string;
  };
};

type SectionState = SectionData & {
  expanded: boolean;
  loading: boolean;
  error: string;
};

type ImageModalState = {
  open: boolean;
  items: SharedFile[];
  index: number;
};

const resolveApiBase = (): string => {
  const configured = String(process.env.NEXT_PUBLIC_API_BASE || '').trim().replace(/\/+$/, '');
  if (configured) return configured;
  return 'https://axyzcloud-a8fgczdhhjhxexhg.centralindia-01.azurewebsites.net';
};
const API_BASE = resolveApiBase();
const DEFAULT_LIMIT = 50;

const isImage = (file: SharedFile) => String(file.mime_type || '').startsWith('image/');
const isVideo = (file: SharedFile) => String(file.mime_type || '').startsWith('video/');
const isPdf = (file: SharedFile) => String(file.mime_type || '').toLowerCase() === 'application/pdf';
const supportsInlinePreview = (file: SharedFile) => isImage(file) || isVideo(file) || isPdf(file);
const getFileLabel = (file: SharedFile) => String(file.display_name || file.relative_path || 'Untitled file').trim() || 'Untitled file';

const formatSize = (bytes: number) => {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
};

export default function ShareV2Client({ slug }: { slug: string }) {
  const searchParams = useSearchParams();
  const secret = String(searchParams.get('k') || '').trim();

  const [sessionToken, setSessionToken] = useState('');
  const [share, setShare] = useState<ShareMeta | null>(null);
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(true);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState('');
  const [requiresPassword, setRequiresPassword] = useState(false);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('name_asc');

  const [sections, setSections] = useState<Record<string, SectionState>>({});
  const sectionsRef = useRef<Record<string, SectionState>>({});
  useEffect(() => { sectionsRef.current = sections; }, [sections]);

  const [previewUrlMap, setPreviewUrlMap] = useState<Record<string, string>>({});
  const [ticketLoadingMap, setTicketLoadingMap] = useState<Record<string, boolean>>({});
  const [zipState, setZipState] = useState<{ loading: boolean; message: string }>({ loading: false, message: '' });

  const [imageModal, setImageModal] = useState<ImageModalState>({ open: false, items: [], index: 0 });
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const swipeStartXRef = useRef<number | null>(null);
  const dragRef = useRef<{ active: boolean; startX: number; startY: number; baseX: number; baseY: number }>({
    active: false,
    startX: 0,
    startY: 0,
    baseX: 0,
    baseY: 0,
  });

  const request = async (url: string, init?: RequestInit) => {
    const headers = new Headers(init?.headers || {});
    if (sessionToken) headers.set('Authorization', `Bearer ${sessionToken}`);
    return fetch(url, { ...init, headers });
  };

  const openShare = async (passwordValue?: string) => {
    if (!slug || !secret) {
      setError('Invalid share link.');
      setLoading(false);
      return;
    }

    setOpening(true);
    setError('');
    try {
      const res = await fetch(`${API_BASE}/api/v2/public/shares/${encodeURIComponent(slug)}/open`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ secret, password: passwordValue || undefined }),
      });
      const payload = await res.json().catch(() => ({}));

      if (!res.ok) {
        const message = String(payload?.message || payload?.error || 'Unable to open share.');
        setError(message);
        setRequiresPassword(message.toLowerCase().includes('password'));
        return;
      }

      setSessionToken(String(payload.session_token || payload.sessionToken || ''));
      setShare(payload.share || null);
      setRequiresPassword(false);
      setPassword('');
    } catch {
      setError('Network error while opening share.');
    } finally {
      setOpening(false);
      setLoading(false);
    }
  };

  const loadMeta = async () => {
    if (!sessionToken) return;
    const res = await request(`${API_BASE}/api/v2/public/shares/${encodeURIComponent(slug)}/meta`);
    const payload = await res.json().catch(() => ({}));
    if (res.ok && payload.share) setShare(payload.share);
  };

  const loadSection = async (path: string, reset: boolean) => {
    if (!sessionToken) return;

    setSections((curr) => ({
      ...curr,
      [path]: {
        path,
        folders: reset ? [] : curr[path]?.folders || [],
        files: reset ? [] : curr[path]?.files || [],
        page: curr[path]?.page || { offset: 0, limit: DEFAULT_LIMIT, total: 0, hasMore: false },
        cursor: curr[path]?.cursor,
        expanded: curr[path]?.expanded ?? true,
        loading: true,
        error: '',
      },
    }));

    const current = sectionsRef.current[path];
    const params = new URLSearchParams({
      path,
      limit: String(DEFAULT_LIMIT),
      sort,
    });
    if (!reset && current?.cursor?.next) params.set('cursor', current.cursor.next);
    if (!reset && !current?.cursor?.next) params.set('offset', String(current?.files.length || 0));
    if (search.trim()) params.set('search', search.trim());

    try {
      const res = await request(`${API_BASE}/api/v2/public/shares/${encodeURIComponent(slug)}/items?${params.toString()}`);
      const payload = await res.json().catch(() => ({}));

      if (!res.ok) {
        const msg = String(payload?.message || payload?.error || 'Unable to load items.');
        setSections((curr) => ({
          ...curr,
          [path]: {
            ...(curr[path] || { path, folders: [], files: [], page: { offset: 0, limit: DEFAULT_LIMIT, total: 0, hasMore: false }, expanded: true }),
            loading: false,
            error: msg,
          },
        }));
        return;
      }

      if (payload.share) setShare(payload.share);
      const files = Array.isArray(payload.files) ? payload.files : [];
      const folders = Array.isArray(payload.folders) ? payload.folders : [];

      setSections((curr) => {
        const prev = curr[path];
        const merged = reset ? files : [...(prev?.files || []), ...files];
        return {
          ...curr,
          [path]: {
            path: payload.path || path,
            folders,
            files: merged,
            page: payload.page || { offset: 0, limit: DEFAULT_LIMIT, total: merged.length, hasMore: false },
            cursor: payload.cursor,
            expanded: prev?.expanded ?? true,
            loading: false,
            error: '',
          },
        };
      });
    } catch {
      setSections((curr) => ({
        ...curr,
        [path]: {
          ...(curr[path] || { path, folders: [], files: [], page: { offset: 0, limit: DEFAULT_LIMIT, total: 0, hasMore: false }, expanded: true }),
          loading: false,
          error: 'Network error while loading files.',
        },
      }));
    }
  };

  const getTicketUrl = async (itemId: string, disposition: 'inline' | 'attachment') => {
    const cacheKey = `${itemId}:${disposition}`;
    if (previewUrlMap[cacheKey]) return previewUrlMap[cacheKey];

    setTicketLoadingMap((curr) => ({ ...curr, [cacheKey]: true }));
    try {
      const res = await request(`${API_BASE}/api/v2/public/shares/${encodeURIComponent(slug)}/items/${encodeURIComponent(itemId)}/preview-ticket`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ disposition }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok || !payload.ticket) return '';

      const url = `${API_BASE}/api/v2/public/stream/${encodeURIComponent(String(payload.ticket))}`;
      setPreviewUrlMap((curr) => ({ ...curr, [cacheKey]: url }));
      return url;
    } finally {
      setTicketLoadingMap((curr) => ({ ...curr, [cacheKey]: false }));
    }
  };

  const handleDownloadItem = async (item: SharedFile) => {
    if (!share?.allowDownload) return;
    const url = await getTicketUrl(item.id, 'attachment');
    if (!url) {
      setError('File temporarily unavailable');
      return;
    }
    const a = document.createElement('a');
    a.href = url;
    a.download = getFileLabel(item);
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const pollZipJob = async (pollingUrl: string) => {
    const started = Date.now();
    while (Date.now() - started < 10 * 60 * 1000) {
      const res = await request(`${API_BASE}${pollingUrl}`);
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload?.message || payload?.error || 'ZIP job failed.');

      const job = payload?.job;
      if (!job) throw new Error('Invalid ZIP job response.');
      if (job.status === 'failed') throw new Error(job.error_message || 'ZIP generation failed.');
      if (job.status === 'completed' && job.download_url) {
        const dlRes = await request(`${API_BASE}${job.download_url}`);
        if (!dlRes.ok) throw new Error('ZIP download failed.');
        const blob = await dlRes.blob();
        const obj = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = obj;
        a.download = `${slug}.zip`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(obj);
        return;
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
    throw new Error('ZIP generation timed out.');
  };

  const handleDownloadAll = async () => {
    setZipState({ loading: true, message: 'Preparing ZIP...' });
    try {
      const res = await request(`${API_BASE}/api/v2/public/shares/${encodeURIComponent(slug)}/download-all`);
      const contentType = String(res.headers.get('content-type') || '');

      if (res.status === 202 || contentType.includes('application/json')) {
        const payload = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(payload?.message || payload?.error || 'Failed to start ZIP generation.');
        const pollingUrl = String(payload?.polling_url || '');
        if (!pollingUrl) throw new Error('Missing ZIP polling URL.');
        setZipState({ loading: true, message: 'Generating ZIP...' });
        await pollZipJob(pollingUrl);
        setZipState({ loading: false, message: '' });
        return;
      }

      if (!res.ok) throw new Error('Failed to download ZIP.');
      const blob = await res.blob();
      const obj = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = obj;
      a.download = `${slug}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(obj);
      setZipState({ loading: false, message: '' });
    } catch (err: any) {
      setZipState({ loading: false, message: '' });
      setError(String(err?.message || 'Failed to download ZIP.'));
    }
  };

  useEffect(() => {
    void openShare();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, secret]);

  useEffect(() => {
    if (!sessionToken) return;
    void loadMeta();
    setSections({});
    void loadSection('/', true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionToken, sort, search]);

  const allLoadedFiles = useMemo(() => {
    const list: SharedFile[] = [];
    Object.values(sections).forEach((section) => {
      section.files.forEach((f) => list.push(f));
    });
    return list;
  }, [sections]);

  const activeImage = imageModal.items[imageModal.index];

  const openImageModal = (item: SharedFile) => {
    const images = allLoadedFiles.filter(isImage);
    const idx = Math.max(0, images.findIndex((x) => x.id === item.id));
    setImageModal({ open: true, items: images, index: idx });
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  const handleImageNav = (delta: number) => {
    setImageModal((curr) => {
      if (!curr.items.length) return curr;
      const next = (curr.index + delta + curr.items.length) % curr.items.length;
      return { ...curr, index: next };
    });
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  const onImagePointerDown = (event: React.PointerEvent<HTMLImageElement>) => {
    dragRef.current = {
      active: true,
      startX: event.clientX,
      startY: event.clientY,
      baseX: pan.x,
      baseY: pan.y,
    };
  };

  const onImagePointerMove = (event: React.PointerEvent<HTMLImageElement>) => {
    if (!dragRef.current.active || zoom <= 1) return;
    const dx = event.clientX - dragRef.current.startX;
    const dy = event.clientY - dragRef.current.startY;
    setPan({ x: dragRef.current.baseX + dx, y: dragRef.current.baseY + dy });
  };

  const onImagePointerUp = () => {
    dragRef.current.active = false;
  };

  const onTouchStart = (event: React.TouchEvent<HTMLDivElement>) => {
    swipeStartXRef.current = event.touches[0]?.clientX ?? null;
  };

  const onTouchEnd = (event: React.TouchEvent<HTMLDivElement>) => {
    const start = swipeStartXRef.current;
    const end = event.changedTouches[0]?.clientX ?? null;
    swipeStartXRef.current = null;
    if (start === null || end === null) return;
    const delta = end - start;
    if (Math.abs(delta) < 60) return;
    if (delta < 0) handleImageNav(1);
    else handleImageNav(-1);
  };

  const renderPreview = (file: SharedFile) => {
    const inlineKey = `${file.id}:inline`;
    const inlineUrl = previewUrlMap[inlineKey];
    const canPreviewInline = supportsInlinePreview(file);

    return (
      <div className={styles.previewBox}>
        <div className={styles.previewMedia}>
        {isImage(file) && inlineUrl ? (
          <img src={inlineUrl} alt={getFileLabel(file)} className={styles.previewImage} onClick={() => openImageModal(file)} />
        ) : null}
        {isVideo(file) && inlineUrl ? (
          <video className={styles.previewVideo} controls preload="metadata" src={inlineUrl} />
        ) : null}
        {isPdf(file) && inlineUrl ? (
          <iframe className={styles.previewPdf} src={inlineUrl} title={getFileLabel(file)} />
        ) : null}
        {!inlineUrl ? (
          <div className={styles.previewPlaceholder}>
            <span className={styles.previewPlaceholderIcon}>
              {isImage(file) ? 'IMG' : isVideo(file) ? 'VID' : isPdf(file) ? 'PDF' : 'FILE'}
            </span>
            <p className={styles.previewPlaceholderTitle}>
              {!canPreviewInline ? 'Preview unavailable' : share?.allowPreview ? 'Preview available on demand' : 'Preview disabled'}
            </p>
            <p className={styles.previewPlaceholderText}>
              {!canPreviewInline
                ? 'This file type cannot be previewed in the browser. Download it to view the contents.'
                : share?.allowPreview
                  ? 'Load a secure preview for this file.'
                  : 'Download the file to view its contents.'}
            </p>
            <button
              type="button"
              className={styles.previewBtn}
              disabled={ticketLoadingMap[inlineKey] || !share?.allowPreview || !canPreviewInline}
              onClick={async () => {
                const url = await getTicketUrl(file.id, 'inline');
                if (!url) setError('File temporarily unavailable');
              }}
            >
              {ticketLoadingMap[inlineKey] ? 'Loading preview...' : 'Load Preview'}
            </button>
          </div>
        ) : null}
        </div>
      </div>
    );
  };

  const renderLoadingScreen = () => (
    <main className={styles.page}>
      <section className={styles.loadingShell}>
        <div className={styles.loadingBrand}>
          <span className={styles.loadingBadge}>AXYA</span>
          <h1 className={styles.loadingTitle}>AXYA Share</h1>
          <p className={styles.loadingText}>Preparing a secure preview of this shared content.</p>
        </div>

        <div className={styles.loadingSpinnerWrap}>
          <span className={styles.loadingSpinner} aria-hidden="true" />
        </div>

        <div className={styles.skeletonHero} />

        <div className={styles.skeletonGrid}>
          {Array.from({ length: 6 }).map((_, idx) => (
            <article key={idx} className={styles.skeletonCard}>
              <div className={styles.skeletonThumb} />
              <div className={styles.skeletonLineLg} />
              <div className={styles.skeletonLineSm} />
              <div className={styles.skeletonButton} />
            </article>
          ))}
        </div>
      </section>
    </main>
  );

  if (loading) {
    return renderLoadingScreen();
  }

  return (
    <main className={styles.page}>
      <section className={styles.panel}>
        <div className={styles.headerRow}>
          <div>
            <p className={styles.kicker}>AXYA SHARE</p>
            <h1 className={styles.title}>{share?.resourceType === 'folder' ? 'Shared Folder' : 'Shared File'}</h1>
            <p className={styles.subtitle}>{share?.fileCount || 0} file(s)</p>
          </div>
          {share?.resourceType === 'folder' && share?.allowDownload ? (
            <button type="button" className={styles.primaryBtn} disabled={zipState.loading} onClick={handleDownloadAll}>
              {zipState.loading ? (zipState.message || 'Processing...') : 'Download All ZIP'}
            </button>
          ) : null}
        </div>

        {requiresPassword ? (
          <form
            className={styles.passwordGate}
            onSubmit={(e) => {
              e.preventDefault();
              void openShare(password);
            }}
          >
            <div className={styles.passwordCard}>
              <span className={styles.passwordBadge}>Secure Link</span>
              <h2 className={styles.passwordTitle}>Protected Share</h2>
              <p className={styles.passwordText}>
                This shared page is locked. Enter the password to continue.
              </p>
              <div className={styles.passwordInputWrap}>
                <input
                  className={styles.passwordInput}
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter password"
                />
                <button
                  type="button"
                  className={styles.passwordToggle}
                  onClick={() => setShowPassword((curr) => !curr)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? 'Hide' : 'Show'}
                </button>
              </div>
              {error ? <p className={styles.inlineError}>{error}</p> : null}
              <button type="submit" className={styles.primaryBtn} disabled={opening}>
                {opening ? 'Unlocking...' : 'Unlock Share'}
              </button>
            </div>
          </form>
        ) : null}

        {error && !requiresPassword ? <p className={styles.error}>{error}</p> : null}

        {sessionToken ? (
          <>
            <div className={styles.controls}>
              <input
                className={styles.input}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search files"
              />
              <select className={styles.input} value={sort} onChange={(e) => setSort(e.target.value)}>
                <option value="name_asc">Name A-Z</option>
                <option value="name_desc">Name Z-A</option>
                <option value="size_desc">Largest first</option>
                <option value="size_asc">Smallest first</option>
                <option value="date_desc">Newest first</option>
                <option value="date_asc">Oldest first</option>
              </select>
            </div>

            {Object.entries(sections).length === 0 ? <p className={styles.note}>No content loaded.</p> : null}

            {Object.entries(sections).map(([key, section]) => (
              <section key={key} className={styles.sectionCard}>
                <button
                  type="button"
                  className={styles.sectionHead}
                  onClick={() => {
                    setSections((curr) => ({ ...curr, [key]: { ...curr[key], expanded: !curr[key].expanded } }));
                    if (!sections[key]?.expanded && !sections[key]?.files.length && !sections[key]?.folders.length) {
                      void loadSection(key, true);
                    }
                  }}
                >
                  <span>{section.path || '/'}</span>
                  <span>{section.expanded ? '-' : '+'}</span>
                </button>

                {section.expanded ? (
                  <div className={styles.sectionBody}>
                    {section.error ? <p className={styles.error}>{section.error}</p> : null}
                    {section.loading ? (
                      <div className={styles.inlineSkeletonGrid}>
                        {Array.from({ length: 3 }).map((_, idx) => (
                          <article key={idx} className={styles.skeletonCard}>
                            <div className={styles.skeletonThumb} />
                            <div className={styles.skeletonLineLg} />
                            <div className={styles.skeletonLineSm} />
                            <div className={styles.skeletonButton} />
                          </article>
                        ))}
                      </div>
                    ) : null}

                    {section.folders.length > 0 ? (
                      <div className={styles.folderList}>
                        {section.folders.map((folder) => (
                          <button
                            key={`${key}-${folder.path}`}
                            className={styles.folderBtn}
                            type="button"
                            onClick={() => {
                              const nextPath = String(folder.path || '/');
                              if (sections[nextPath]) {
                                setSections((curr) => ({ ...curr, [nextPath]: { ...curr[nextPath], expanded: !curr[nextPath].expanded } }));
                              } else {
                                void loadSection(nextPath, true);
                              }
                            }}
                          >
                            <span>{folder.name}</span>
                            <small>{folder.fileCount} files</small>
                          </button>
                        ))}
                      </div>
                    ) : null}

                    {section.files.length > 0 ? (
                      <div className={styles.fileGrid}>
                        {section.files.map((file) => (
                          <article key={file.id} className={styles.fileCard}>
                            <div className={styles.fileTop}>
                              <div className={styles.fileIcon}>
                                {isImage(file) ? 'IMG' : isVideo(file) ? 'VID' : isPdf(file) ? 'PDF' : 'DOC'}
                              </div>
                              <div className={styles.fileMeta}>
                                <strong title={getFileLabel(file)}>{getFileLabel(file)}</strong>
                                <span>{formatSize(Number(file.size_bytes || 0))}</span>
                              </div>
                            </div>

                            {renderPreview(file)}

                            <div className={styles.fileActions}>
                              <button
                                type="button"
                                className={styles.downloadBtn}
                                disabled={!share?.allowDownload}
                                onClick={() => void handleDownloadItem(file)}
                              >
                                <span className={styles.downloadIcon}>Ôåô</span>
                                <span>Download</span>
                              </button>
                            </div>
                          </article>
                        ))}
                      </div>
                    ) : null}

                    {!section.loading && section.files.length === 0 && section.folders.length === 0 ? (
                      <p className={styles.note}>Empty folder.</p>
                    ) : null}

                    {section.page?.hasMore ? (
                      <button type="button" className={styles.secondaryBtn} onClick={() => void loadSection(key, false)}>
                        Load more
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </section>
            ))}
          </>
        ) : null}
      </section>

      {imageModal.open && activeImage ? (
        <div className={styles.modal} onClick={() => setImageModal({ open: false, items: [], index: 0 })}>
          <div className={styles.modalInner} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalToolbar}>
              <button type="button" className={styles.secondaryBtn} onClick={() => handleImageNav(-1)}>Prev</button>
              <input
                type="range"
                min={1}
                max={4}
                step={0.1}
                value={zoom}
                onChange={(e) => {
                  setZoom(Number(e.target.value));
                  if (Number(e.target.value) <= 1) setPan({ x: 0, y: 0 });
                }}
              />
              <button type="button" className={styles.secondaryBtn} onClick={() => handleImageNav(1)}>Next</button>
            </div>
            <div className={styles.modalViewport} onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
              <img
                src={previewUrlMap[`${activeImage.id}:inline`] || ''}
                alt={getFileLabel(activeImage)}
                className={styles.modalImage}
                style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}
                onPointerDown={onImagePointerDown}
                onPointerMove={onImagePointerMove}
                onPointerUp={onImagePointerUp}
                onPointerLeave={onImagePointerUp}
              />
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
