'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { API_URL as API_BASE } from '../../../lib/urls';
import { ShareHeader } from '../../../components/share/ShareHeader';
import { ShareCard } from '../../../components/share/ShareCard';
import { FileGrid } from '../../../components/share/FileGrid';
import { PreviewModal } from '../../../components/share/PreviewModal';
import { Lock, EyeOff, Search, FolderOpen, ChevronDown, ChevronRight } from 'lucide-react';

const activeTicketRequests = new Map<string, Promise<string>>();

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

type ApiFailure = {
  status: number;
  code: string;
  message: string;
  retryable: boolean;
};

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
  const [infoMessage, setInfoMessage] = useState('');
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
  const [previewErrorMap, setPreviewErrorMap] = useState<Record<string, string>>({});

  const request = async (url: string, init?: RequestInit) => {
    const headers = new Headers(init?.headers || {});
    if (sessionToken) headers.set('Authorization', `Bearer ${sessionToken}`);
    return fetch(url, { ...init, headers });
  };

  const toApiFailure = (res: Response, payload: any): ApiFailure => ({
    status: res.status,
    code: String(payload?.code || ''),
    message: String(payload?.message || payload?.error || 'Request failed.'),
    retryable: Boolean(payload?.retryable),
  });

  const applyAccessFailure = (failure: ApiFailure, fallbackMessage: string) => {
    const code = String(failure.code || '').toLowerCase();

    if (code === 'invalid_password') {
      setRequiresPassword(true);
      setError('Incorrect password. Please try again.');
      return;
    }
    if (code === 'share_expired') {
      setSessionToken('');
      setRequiresPassword(false);
      setError('This share link has expired.');
      return;
    }
    if (code === 'share_revoked') {
      setSessionToken('');
      setRequiresPassword(false);
      setError('This share link has been revoked.');
      return;
    }
    if (code === 'invalid_secret') {
      setSessionToken('');
      setRequiresPassword(false);
      setError('Invalid share link. Please verify the link and try again.');
      return;
    }
    if (code.startsWith('share_session_')) {
      setSessionToken('');
      setRequiresPassword(Boolean(share?.requiresPassword));
      setError('Your access session expired. Please unlock the share again.');
      return;
    }
    if (failure.status === 429 || code === 'rate_limited') {
      setError('Too many requests. Please wait a moment and try again.');
      return;
    }
    setError(failure.message || fallbackMessage);
  };

  const openShare = async (passwordValue?: string) => {
    if (!slug || !secret) {
      setError('Invalid share link.');
      setLoading(false);
      return;
    }

    setOpening(true);
    setError('');
    setInfoMessage('');
    try {
      const res = await fetch(`${API_BASE}/api/v2/public/shares/${encodeURIComponent(slug)}/open`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ secret, password: passwordValue || undefined }),
      });
      const payload = await res.json().catch(() => ({}));

      if (!res.ok) {
        applyAccessFailure(toApiFailure(res, payload), 'Unable to open share.');
        setSessionToken('');
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
    if (!res.ok) {
      applyAccessFailure(toApiFailure(res, payload), 'Unable to load share details.');
      return;
    }
    if (payload.share) setShare(payload.share);
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
        const failure = toApiFailure(res, payload);
        if (failure.status === 401 || failure.status === 410 || String(failure.code || '').startsWith('share_session_')) {
          applyAccessFailure(failure, 'Access to this share was lost.');
        }
        const msg = failure.message || 'Unable to load items.';
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

        const prevFiles = prev?.files || [];
        const newFiles = files.filter((f: any) => !prevFiles.some((pf: any) => pf.id === f.id));
        const mergedFiles = reset ? files : [...prevFiles, ...newFiles];

        const prevFolders = prev?.folders || [];
        const newFolders = folders.filter((f: any) => !prevFolders.some((pf: any) => pf.path === f.path));
        const mergedFolders = reset ? folders : [...prevFolders, ...newFolders];

        return {
          ...curr,
          [path]: {
            path: payload.path || path,
            folders: mergedFolders,
            files: mergedFiles,
            page: payload.page || { offset: 0, limit: DEFAULT_LIMIT, total: mergedFiles.length, hasMore: false },
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

  const getTicketUrl = async (itemId: string, disposition: 'inline' | 'attachment' | 'thumbnail') => {
    const cacheKey = `${itemId}:${disposition}`;
    if (previewUrlMap[cacheKey]) return previewUrlMap[cacheKey];

    // Deduplicate identical simultaneous requests using a Promise map
    if (activeTicketRequests.has(cacheKey)) {
      return activeTicketRequests.get(cacheKey)!;
    }

    const fetchTicket = async () => {
      setTicketLoadingMap((curr) => ({ ...curr, [cacheKey]: true }));
      try {
        const res = await request(`${API_BASE}/api/v2/public/shares/${encodeURIComponent(slug)}/items/${encodeURIComponent(itemId)}/preview-ticket`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ disposition }),
        });
        const payload = await res.json().catch(() => ({}));
        if (!res.ok || !payload.ticket) {
          const failure = toApiFailure(res, payload);
          if (failure.status === 401 || failure.status === 410 || String(failure.code || '').startsWith('share_session_')) {
            applyAccessFailure(failure, 'Preview access expired.');
          }
          if (disposition === 'inline') {
            setPreviewErrorMap((curr) => ({
              ...curr,
              [itemId]: failure.message || 'Preview temporarily unavailable for this file.',
            }));
          }
          return '';
        }

        const url = `${API_BASE}/api/v2/public/stream/${encodeURIComponent(String(payload.ticket))}`;
        setPreviewUrlMap((curr) => ({ ...curr, [cacheKey]: url }));
        return url;
      } catch {
        return '';
      } finally {
        setTicketLoadingMap((curr) => ({ ...curr, [cacheKey]: false }));
        activeTicketRequests.delete(cacheKey);
      }
    };

    const promise = fetchTicket();
    activeTicketRequests.set(cacheKey, promise);
    return promise;
  };

  const handleDownloadItem = async (item: SharedFile) => {
    if (!share?.allowDownload) return;
    const url = await getTicketUrl(item.id, 'attachment');
    if (!url) {
      setError('File temporarily unavailable. Please try again.');
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
    if (!infoMessage) return;
    const timer = window.setTimeout(() => setInfoMessage(''), 2500);
    return () => window.clearTimeout(timer);
  }, [infoMessage]);

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
    const idx = Math.max(0, allLoadedFiles.findIndex((x) => x.id === item.id));
    setImageModal({ open: true, items: allLoadedFiles, index: idx });
  };

  const handleImageNav = (delta: number) => {
    setImageModal((curr) => {
      if (!curr.items.length) return curr;
      const next = (curr.index + delta + curr.items.length) % curr.items.length;
      return { ...curr, index: next };
    });
  };

  const handleShareItem = async () => {
    if (typeof window === 'undefined') return;
    const shareUrl = window.location.href;
    const nav = navigator as Navigator & { share?: (data: { title?: string; text?: string; url?: string }) => Promise<void> };
    try {
      if (typeof nav.share === 'function') {
        await nav.share({
          title: 'Shared files',
          text: 'View this shared link',
          url: shareUrl,
        });
        return;
      }
      await navigator.clipboard.writeText(shareUrl);
      setInfoMessage('Share link copied to clipboard.');
    } catch {
      setError('Unable to share link right now.');
    }
  };


  const renderLoadingScreen = () => (
    <div className="min-h-screen bg-brand-bg flex flex-col font-sans">
      <header className="flex items-center justify-between py-4 px-6 mb-6">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-neutral-200 to-neutral-300 animate-pulse" />
          <div className="h-6 w-32 bg-neutral-200 rounded animate-pulse" />
        </div>
      </header>
      <main className="flex-1 max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-8 space-y-8">
        <div className="h-32 w-full bg-white rounded-2xl shadow-sm animate-pulse" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-48 bg-white rounded-2xl shadow-sm animate-pulse" />
          ))}
        </div>
      </main>
    </div>
  );

  if (loading) {
    return renderLoadingScreen();
  }

  return (
    <div className="min-h-screen bg-brand-bg text-brand-text font-sans antialiased pb-24 selection:bg-brand-start/20 selection:text-brand-start">
      <ShareHeader
        share={share}
        totalSizeText={share ? formatSize(Number(allLoadedFiles.reduce((acc, f) => acc + (f.size_bytes || 0), 0))) : undefined}
      />

      <main className="w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {share && (
          <ShareCard
            share={share}
            onDownloadAll={share.resourceType === 'folder' && share.allowDownload ? handleDownloadAll : undefined}
            downloading={zipState.loading}
          />
        )}

        {requiresPassword && (
          <div className="max-w-md mx-auto mt-12 bg-white rounded-2xl p-8 shadow-card border border-neutral-100 text-center">
            <div className="w-16 h-16 bg-amber-50 rounded-full flex items-center justify-center mx-auto mb-6 text-amber-500">
              <Lock className="w-8 h-8" />
            </div>
            <h2 className="text-2xl font-bold mb-2">Protected Share</h2>
            <p className="text-brand-muted mb-6">This shared page is locked. Enter the password to continue.</p>
            <form onSubmit={(e) => { e.preventDefault(); void openShare(password); }} className="space-y-4">
              <div className="relative">
                <input
                  className="w-full pl-4 pr-12 py-3 rounded-xl border border-neutral-200 focus:outline-none focus:ring-2 focus:ring-brand-start/50 transition-all bg-neutral-50 focus:bg-white"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter password"
                />
                <button
                  type="button"
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-brand-muted hover:text-brand-text"
                  onClick={() => setShowPassword((curr) => !curr)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff className="w-5 h-5" /> : <Lock className="w-5 h-5" />}
                </button>
              </div>
              {error && <p className="text-red-500 text-sm">{error}</p>}
              <button
                type="submit"
                disabled={opening}
                className="w-full py-3 rounded-xl bg-gradient-to-r from-brand-start to-brand-end text-white font-medium hover:shadow-lg hover:-translate-y-0.5 transition-all disabled:opacity-70"
              >
                {opening ? 'Unlocking...' : 'Unlock Share'}
              </button>
            </form>
          </div>
        )}

        {error && !requiresPassword && (
          <div className="p-4 mb-6 rounded-xl bg-red-50 text-red-600 border border-red-100 max-w-3xl mx-auto text-center">{error}</div>
        )}

        {infoMessage && !requiresPassword && (
          <div className="p-4 mb-6 rounded-xl bg-emerald-50 text-emerald-700 border border-emerald-100 max-w-3xl mx-auto text-center">{infoMessage}</div>
        )}

        {sessionToken && !requiresPassword && (
          <div className="space-y-8 animate-in fade-in duration-500">
            {/* Toolbar */}
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4 bg-white/50 p-2 rounded-2xl backdrop-blur-md border border-white">
              <div className="relative w-full sm:w-72">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-brand-muted" />
                <input
                  className="w-full pl-9 pr-4 py-2.5 rounded-xl bg-transparent border-transparent focus:bg-white focus:border-brand-start/30 focus:ring-2 focus:ring-brand-start/20 transition-all shadow-sm"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search files..."
                />
              </div>
              <select
                className="w-full sm:w-auto px-4 py-2.5 rounded-xl bg-transparent focus:bg-white border-transparent focus:ring-2 focus:ring-brand-start/20 shadow-sm cursor-pointer text-brand-text font-medium transition-all"
                value={sort}
                onChange={(e) => setSort(e.target.value)}
              >
                <option value="name_asc">Name A-Z</option>
                <option value="name_desc">Name Z-A</option>
                <option value="size_desc">Largest first</option>
                <option value="size_asc">Smallest first</option>
                <option value="date_desc">Newest first</option>
                <option value="date_asc">Oldest first</option>
              </select>
            </div>

            {Object.entries(sections).length === 0 && !loading && (
              <div className="text-center py-12 text-brand-muted">No content loaded.</div>
            )}

            {Object.entries(sections).map(([key, section]) => (
              <section key={key} className="space-y-4">
                {key && key !== '/' && (
                  <button
                    type="button"
                    className="flex items-center gap-2 group w-full text-left"
                    onClick={() => {
                      setSections((curr) => ({ ...curr, [key]: { ...curr[key], expanded: !curr[key].expanded } }));
                      if (!sections[key]?.expanded && !sections[key]?.files.length && !sections[key]?.folders.length) {
                        void loadSection(key, true);
                      }
                    }}
                  >
                    <div className="p-1.5 rounded-lg bg-brand-light text-brand-start group-hover:bg-brand-start group-hover:text-white transition-colors">
                      {section.expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                    </div>
                    <span className="font-semibold text-lg text-brand-text">{section.path}</span>
                  </button>
                )}

                {section.expanded && (
                  <div className="space-y-6">
                    {section.error && <p className="text-red-500">{section.error}</p>}

                    {section.folders.length > 0 && (
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                        {section.folders.map((folder) => (
                          <button
                            key={`${key}-${folder.path}`}
                            className="flex items-center gap-4 p-4 rounded-2xl bg-white border border-neutral-100 shadow-sm hover:shadow-md hover:border-brand-start/30 transition-all text-left"
                            onClick={() => {
                              const nextPath = String(folder.path || '/');
                              if (sections[nextPath]) {
                                setSections((curr) => ({ ...curr, [nextPath]: { ...curr[nextPath], expanded: !curr[nextPath].expanded } }));
                              } else {
                                void loadSection(nextPath, true);
                              }
                            }}
                          >
                            <div className="p-3 bg-brand-light rounded-xl text-brand-start">
                              <FolderOpen className="w-6 h-6" />
                            </div>
                            <div>
                              <div className="font-semibold text-brand-text truncate break-all">{folder.name}</div>
                              <div className="text-sm text-brand-muted">{folder.fileCount} files</div>
                            </div>
                          </button>
                        ))}
                      </div>
                    )}

                    {section.files.length > 0 && (
                      <FileGrid
                        files={section.files}
                        share={share as ShareMeta}
                        onPreview={(file) => openImageModal(file)}
                        onDownload={(file) => handleDownloadItem(file)}
                        ticketMap={ticketLoadingMap}
                        previewUrlMap={previewUrlMap}
                        onLoadThumbnail={(file) => void getTicketUrl(file.id, 'thumbnail')}
                        onEndReached={() => {
                          if (section.page?.hasMore && !section.loading) void loadSection(key, false);
                        }}
                      />
                    )}

                    {!section.loading && section.files.length === 0 && section.folders.length === 0 && (
                      <p className="text-brand-muted text-center py-8">Empty folder.</p>
                    )}

                    {section.loading && section.files.length > 0 && (
                      <div className="flex justify-center pt-4 pb-8">
                        <div className="w-8 h-8 border-4 border-brand-start border-t-transparent rounded-full animate-spin" />
                      </div>
                    )}
                  </div>
                )}
              </section>
            ))}
          </div>
        )}
      </main>

      <PreviewModal
        isOpen={imageModal.open}
        onClose={() => setImageModal({ open: false, items: [], index: 0 })}
        files={imageModal.items}
        currentIndex={imageModal.index}
        onNext={() => handleImageNav(1)}
        onPrev={() => handleImageNav(-1)}
        onDownload={handleDownloadItem}
        onShare={handleShareItem}
        share={share as ShareMeta}
        previewUrlMap={previewUrlMap}
        previewErrors={previewErrorMap}
        onPreviewMediaError={(file) => {
          setPreviewErrorMap((curr) => ({
            ...curr,
            [file.id]: 'Preview session may have expired. Please retry preview.',
          }));
        }}
        onLoadPreview={async (file) => {
          if (!supportsInlinePreview(file)) return;
          setPreviewErrorMap((curr) => ({ ...curr, [file.id]: '' }));
          const url = await getTicketUrl(file.id, 'inline');
          if (!url) {
            setPreviewErrorMap((curr) => ({
              ...curr,
              [file.id]: curr[file.id] || 'Preview temporarily unavailable for this file.',
            }));
          }
        }}
      />
    </div>
  );
}
