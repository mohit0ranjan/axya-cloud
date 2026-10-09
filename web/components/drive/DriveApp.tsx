'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Folder, File, Search, Plus, Star, Trash2, Grid2X2, List, ArrowLeft, Download, MoreHorizontal, X, Upload, LogOut, RefreshCw, Mic, Square, Share2, Check, HardDrive } from 'lucide-react';
import { api, mutate, ApiError } from '../../lib/api';
import { MediaPreview } from './MediaPreview';
import { API_URL } from '../../lib/urls';
import { useUploadManager } from '../../hooks/useUploadManager';

type DriveFile = { id: string; name: string; size: number; mime_type: string; is_starred: boolean; created_at: string };
type DriveFolder = { id: string; name: string; total_file_count?: number };
type User = { id: string; name?: string; phone: string };
const sizeLabel = (size: number) => { const units = ['B', 'KB', 'MB', 'GB']; const index = Math.min(3, Math.max(0, Math.floor(Math.log(Math.max(1, size)) / Math.log(1024)))); return `${(size / 1024 ** index).toFixed(index ? 1 : 0)} ${units[index]}`; };
const primary = 'rounded-xl bg-[#5B7CFF] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#4B6EF5] disabled:opacity-50';
const secondary = 'rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm transition hover:bg-slate-50 disabled:opacity-50';

function Dialog({ title, close, children }: { title: string; close: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const previous = document.activeElement as HTMLElement; ref.current?.showModal(); ref.current?.querySelector<HTMLInputElement>('input')?.focus(); return () => previous?.focus(); }, []);
  return <dialog ref={ref} onCancel={e => { e.preventDefault(); close(); }} className="m-auto max-h-[90dvh] w-[min(92vw,640px)] overflow-auto rounded-2xl border border-slate-100 bg-white p-6 text-slate-800 shadow-xl backdrop:bg-slate-900/60">
    <div className="mb-5 flex items-center justify-between gap-4"><h2 className="truncate text-lg font-semibold">{title}</h2><button type="button" onClick={close} aria-label="Close dialog" className="rounded-lg p-2 hover:bg-slate-100"><X size={20} /></button></div>{children}</dialog>;
}

export default function DriveApp() {
  const [user, setUser] = useState<User | null>(null);
  const [checking, setChecking] = useState(true);
  const [connectionError, setConnectionError] = useState('');
  const check = useCallback(async () => {
    setChecking(true); setConnectionError('');
    try { const data = await api('/auth/me'); setUser(data.user); }
    catch (error) { if (!(error instanceof ApiError && error.status === 401)) setConnectionError((error as Error).message); }
    finally { setChecking(false); }
  }, []);
  useEffect(() => { void check(); }, [check]);
  if (checking) return <main className="grid min-h-dvh place-items-center bg-[#F8FAFC]"><p role="status" className="text-slate-500">Opening your drive…</p></main>;
  if (connectionError) return <main className="grid min-h-dvh place-items-center bg-[#F8FAFC]"><div className="max-w-md p-8 text-center"><h1 className="mb-3 text-xl font-semibold">Your drive is temporarily unavailable</h1><p role="alert" className="mb-5 text-slate-500">{connectionError}</p><button className={primary} onClick={() => void check()}>Try again</button></div></main>;
  if (!user) return <SignIn complete={setUser} />;
  return <Workspace key={user.id} user={user} signedOut={() => setUser(null)} />;
}

function SignIn({ complete }: { complete: (user: User) => void }) {
  const [phone, setPhone] = useState(''); const [code, setCode] = useState(''); const [password, setPassword] = useState('');
  const [challenge, setChallenge] = useState<{ phoneCodeHash: string; tempSession: string }>();
  const [needsPassword, setNeedsPassword] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); if (busy) return; setBusy(true); setError('');
    try {
      if (!challenge) {
        if (!/^\+[1-9]\d{6,14}$/.test(phone.replace(/\s/g, ''))) throw new Error('Enter your phone number with its country code, such as +91…');
        setChallenge(await mutate('/auth/send-code', { phoneNumber: phone.replace(/\s/g, '') }));
      } else {
        const data = await mutate('/auth/verify-code', { phoneNumber: phone.replace(/\s/g, ''), phoneCode: code, ...challenge, password: password || undefined, platform: 'web' });
        complete(data.user);
      }
    } catch (problem) { if (problem instanceof ApiError && problem.code === 'TELEGRAM_2FA_REQUIRED') setNeedsPassword(true); setError((problem as Error).message); }
    finally { setBusy(false); }
  };
  return <main className="grid min-h-dvh place-items-center bg-[#F8FAFC] p-5"><section className="w-full max-w-md rounded-3xl border border-slate-100 bg-white p-8 shadow-sm">
    <div className="mb-6 flex items-center gap-3"><HardDrive className="text-[#5B7CFF]" size={28} /><span className="text-xl font-semibold">Axya</span></div>
    <h1 className="text-2xl font-semibold">Your files, together.</h1><p className="mb-7 mt-2 text-sm leading-6 text-slate-500">Connect your Telegram account to organize, preview and share your files. Your account and storage stay separate from everyone else's.</p>
    <form onSubmit={submit} className="space-y-4"><label className="block text-sm font-medium">Phone number<input autoComplete="tel" type="tel" required value={phone} disabled={!!challenge} onChange={e => setPhone(e.target.value)} placeholder="+91 98765 43210" className="mt-2 w-full rounded-xl border border-slate-200 p-3" /></label>
      {challenge && <label className="block text-sm font-medium">Telegram verification code<input autoFocus autoComplete="one-time-code" inputMode="numeric" required value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ''))} className="mt-2 w-full rounded-xl border border-slate-200 p-3" /><span className="mt-2 block text-xs text-slate-500">Check your Telegram app for the code.</span></label>}
      {needsPassword && <label className="block text-sm font-medium">Two-step verification password<input autoFocus type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} className="mt-2 w-full rounded-xl border border-slate-200 p-3" /></label>}
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}<button disabled={busy} className={`${primary} w-full`}>{busy ? 'Please wait…' : challenge ? 'Open my drive' : 'Send verification code'}</button>
      {challenge && <button type="button" disabled={busy} onClick={() => { setChallenge(undefined); setCode(''); setPassword(''); setNeedsPassword(false); setError(''); }} className="w-full py-2 text-sm text-[#5B7CFF]">Use another number or request a new code</button>}
    </form></section></main>;
}

function Thumbnail({ file }: { file: DriveFile }) {
  const [failed, setFailed] = useState(false); const [loaded, setLoaded] = useState(false);
  if (failed || !/^(image|video)\//.test(file.mime_type)) return <File size={28} className="text-[#5B7CFF]" />;
  return <div className="relative h-12 w-12 overflow-hidden rounded-lg bg-[#EEF2FF]">{!loaded && <div className="absolute inset-0 animate-pulse bg-[#EEF2FF]" />}<img src={`${API_URL}/files/${encodeURIComponent(file.id)}/thumbnail?w=240`} alt="" loading="lazy" onLoad={() => setLoaded(true)} onError={() => setFailed(true)} className={`h-full w-full object-cover transition-opacity ${loaded ? 'opacity-100' : 'opacity-0'}`} /></div>;
}

function Workspace({ user, signedOut }: { user: User; signedOut: () => void }) {
  const [section, setSection] = useState('files'); const [path, setPath] = useState<DriveFolder[]>([]); const folderId = path.at(-1)?.id;
  const [files, setFiles] = useState<DriveFile[]>([]); const [folders, setFolders] = useState<DriveFolder[]>([]); const [total, setTotal] = useState(0);
  const [query, setQuery] = useState(''); const [search, setSearch] = useState(''); const [sort, setSort] = useState('created_at'); const [grid, setGrid] = useState(false);
  const [loading, setLoading] = useState(true); const [error, setError] = useState(''); const [notice, setNotice] = useState(''); const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<DriveFile>(); const [actionFile, setActionFile] = useState<DriveFile>();
  const [actionFolder, setActionFolder] = useState<DriveFolder>();
  const [movePath, setMovePath] = useState<DriveFolder[]>([]); const [moveFolders, setMoveFolders] = useState<DriveFolder[]>([]);
  const [form, setForm] = useState<'folder' | 'rename' | 'rename-folder' | 'move' | 'storage' | 'share' | undefined>(); const [name, setName] = useState('');
  const [target, setTarget] = useState('me'); const [shareUrl, setShareUrl] = useState(''); const [sharePassword, setSharePassword] = useState('');
  const [shares, setShares] = useState<any[]>([]); const [expiryDays, setExpiryDays] = useState('7');
  const [recording, setRecording] = useState(false); const [recorded, setRecorded] = useState<Blob>(); const [recordedUrl, setRecordedUrl] = useState(''); const recorder = useRef<MediaRecorder | undefined>(undefined);
  const recordingParts = useRef<Blob[]>([]); const picker = useRef<HTMLInputElement>(null); const requests = useRef(0);
  const { tasks, stats, addFiles, pauseTask, resumeTask, cancelTask, retryTask, clearCompleted, storageError } = useUploadManager(user.id);
  useEffect(() => { const timer = setTimeout(() => setSearch(query.trim()), 250); return () => clearTimeout(timer); }, [query]);
  useEffect(() => { setTarget(localStorage.getItem(`axya-storage-${user.id}`) || 'me'); return () => { recorder.current?.stream.getTracks().forEach(track => track.stop()); }; }, [user.id]);
  useEffect(() => { if (recorded) { const url = URL.createObjectURL(recorded); setRecordedUrl(url); return () => { URL.revokeObjectURL(url); }; } }, [recorded]);
  const load = useCallback(async (append = false, offset = 0) => {
    const request = ++requests.current; setLoading(true); setError('');
    try {
      if (section === 'shared') { const data = await api('/api/v2/shares'); if (request === requests.current) setShares(data.shares || []); return; }
      const endpoint = search ? `/files/search?q=${encodeURIComponent(search)}` : section === 'starred' ? '/files/starred' : section === 'trash' ? '/files/trash' : `/files?folder_id=${folderId || 'root'}&sort=${sort}&order=${sort === 'file_name' ? 'ASC' : 'DESC'}`;
      const data = await api(`${endpoint}${endpoint.includes('?') ? '&' : '?'}limit=50&offset=${offset}`);
      const directory = !search && section === 'files' ? await api(`/files/folders${folderId ? `?parent_id=${folderId}` : ''}`) : { folders: [] };
      if (request !== requests.current) return;
      const matchedFiles = search || section === 'trash' ? (search ? data.results || [] : data.files || []).filter((item: any) => item.result_type === 'file') : data.files || [];
      const matchedFolders = search || section === 'trash' ? (search ? data.results || [] : data.files || []).filter((item: any) => item.result_type !== 'file') : directory.folders || [];
      setFiles(previous => append ? [...previous, ...matchedFiles] : matchedFiles); setFolders(matchedFolders); setTotal(data.total_count || matchedFiles.length);
    } catch (problem) { if (request === requests.current) setError((problem as Error).message); }
    finally { if (request === requests.current) setLoading(false); }
  }, [section, search, folderId, sort]);
  useEffect(() => { setFiles([]); setFolders([]); void load(); }, [load]);
  const completed = tasks.filter(task => task.status === 'completed').length;
  useEffect(() => { if (completed) void load(); }, [completed, load]);
  const perform = async (operation: () => Promise<unknown>, success: string) => {
    if (busy) return; setBusy(true); setError('');
    try { await operation(); setNotice(success); setActionFile(undefined); setActionFolder(undefined); setForm(undefined); await load(); }
    catch (problem) { setError((problem as Error).message); } finally { setBusy(false); }
  };
  const upload = (chosen: File[]) => { addFiles(chosen, { folderId, telegramChatId: target }); setNotice(`${chosen.length} file${chosen.length === 1 ? '' : 's'} added to transfers`); };
  const startRecording = async () => {
    try {
      if (!navigator.mediaDevices || typeof MediaRecorder === 'undefined') throw new Error('Recording is not supported in this browser. Upload an audio file instead.');
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const next = new MediaRecorder(stream); recorder.current = next; recordingParts.current = [];
      next.ondataavailable = event => { if (event.data.size) recordingParts.current.push(event.data); };
      next.onstop = () => { setRecorded(new Blob(recordingParts.current, { type: next.mimeType })); stream.getTracks().forEach(track => track.stop()); setRecording(false); };
      next.start(1000); setRecording(true);
    } catch (problem) { setError((problem as Error).message); }
  };
  useEffect(() => {
    if (form !== 'move') return;
    let active = true;
    void api(`/files/folders${movePath.at(-1)?.id ? `?parent_id=${movePath.at(-1)?.id}` : ''}`).then(data => { if (active) setMoveFolders(data.folders || []); }).catch(problem => { if (active) setError(problem.message); });
    return () => { active = false; };
  }, [form, movePath]);
  const closeForm = () => { setForm(undefined); setShareUrl(''); };
  const title = section === 'starred' ? 'Starred' : section === 'trash' ? 'Trash' : section === 'shared' ? 'Shared links' : path.at(-1)?.name || 'My files';
  return <div className="min-h-dvh bg-[#F8FAFC] text-slate-800" onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); if (section === 'files' && e.dataTransfer.files.length) upload(Array.from(e.dataTransfer.files)); }}>
    <aside className="fixed inset-y-0 left-0 hidden w-60 border-r border-slate-100 bg-white p-5 md:block"><div className="mb-9 flex items-center gap-3 px-2"><HardDrive size={26} className="text-[#5B7CFF]" /><span className="text-xl font-semibold">Axya</span></div><button onClick={() => picker.current?.click()} className={`${primary} mb-6 flex items-center gap-2`}><Plus size={19} />Upload files</button>
      <nav className="space-y-1">{[['files', 'My files', Folder], ['starred', 'Starred', Star], ['shared', 'Shared links', Share2], ['trash', 'Trash', Trash2]].map(([key, label, Icon]) => { const Component = Icon as typeof Folder; return <button key={key as string} onClick={() => { setSection(key as string); setPath([]); setQuery(''); }} aria-current={section === key ? 'page' : undefined} className={`flex w-full items-center gap-3 rounded-xl px-4 py-3 text-sm ${section === key ? 'bg-[#EEF2FF] font-semibold text-[#5B7CFF]' : 'hover:bg-slate-50'}`}><Component size={19} />{label as string}</button>; })}</nav>
      <div className="absolute bottom-6 left-5 right-5 border-t border-slate-100 pt-5"><p className="mb-2 truncate text-sm font-medium">{user.name || user.phone}</p><button className="mb-3 block text-xs text-[#5B7CFF]" onClick={() => { setName(target); setForm('storage'); }}>Storage connection</button><button onClick={() => void perform(async () => { await mutate('/auth/logout'); signedOut(); }, 'Signed out')} className="flex items-center gap-2 text-xs text-slate-500"><LogOut size={15} />Sign out</button></div></aside>
    <main className="mx-auto max-w-[1600px] p-4 pb-24 sm:p-6 md:ml-60 md:p-8"><header className="mb-6 flex items-center gap-3"><span className="text-lg font-semibold text-[#5B7CFF] md:hidden">Axya</span><label className="relative flex-1"><Search className="absolute left-4 top-3.5 text-slate-400" size={19} /><input aria-label="Search your files" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search your files" className="w-full max-w-2xl rounded-2xl border border-slate-100 bg-white py-3 pl-12 pr-4 text-sm shadow-sm focus:outline-[#5B7CFF]" /></label><button onClick={() => void load()} disabled={loading} aria-label="Refresh files" className={secondary}><RefreshCw size={18} className={loading ? 'animate-spin' : ''} /></button></header>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-3">{!!path.length && section === 'files' && <button aria-label="Parent folder" onClick={() => setPath(previous => previous.slice(0, -1))} className={secondary}><ArrowLeft size={18} /></button>}<h1 className="text-2xl font-semibold tracking-tight">{search ? 'Search results' : title}</h1></div><div className="flex flex-wrap items-center gap-2">{section === 'files' && <><button className={secondary} onClick={() => { setName(''); setForm('folder'); }}><span className="flex items-center gap-2"><Folder size={17} />New folder</span></button><button className={secondary} onClick={() => void startRecording()} disabled={recording}><span className="flex items-center gap-2"><Mic size={17} />Record audio</span></button><button className={`${primary} md:hidden`} onClick={() => picker.current?.click()}><Upload size={18} /></button></>}<select aria-label="Sort files" value={sort} onChange={e => setSort(e.target.value)} className={secondary}><option value="created_at">Newest first</option><option value="file_name">Name A–Z</option><option value="file_size">Largest first</option></select><button onClick={() => setGrid(value => !value)} aria-label={grid ? 'Use list view' : 'Use grid view'} className={secondary}>{grid ? <List size={18} /> : <Grid2X2 size={18} />}</button></div></div>
      {path.length > 0 && <nav aria-label="Folder path" className="mb-4 flex flex-wrap gap-2 text-sm"><button className="text-[#5B7CFF]" onClick={() => setPath([])}>My files</button>{path.map((folder, index) => <span key={folder.id}> / <button onClick={() => setPath(previous => previous.slice(0, index + 1))}>{folder.name}</button></span>)}</nav>}
      {error && <div role="alert" className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-red-100 bg-red-50 p-4 text-sm text-red-700">{error}<button className="underline" onClick={() => void load()}>Retry</button></div>}
      {storageError && <p role="alert" className="mb-4 rounded-xl bg-amber-50 p-4 text-sm text-amber-800">{storageError}</p>}
      {notice && <div role="status" className="mb-4 flex items-center justify-between gap-3 rounded-xl bg-[#EEF2FF] p-3 text-sm text-[#5B7CFF]">{notice}<button aria-label="Dismiss notification" onClick={() => setNotice('')}><X size={16} /></button></div>}
      {recording && <div role="status" className="mb-4 flex items-center gap-3 rounded-xl bg-white p-4"><Mic className="text-red-500" size={18} /><span className="flex-1 text-sm">Recording…</span><button className={secondary} onClick={() => recorder.current?.stop()}><span className="flex gap-2"><Square size={16} />Stop</span></button></div>}
      {recorded && <Dialog title="Your recording" close={() => setRecorded(undefined)}><audio src={recordedUrl} controls className="mb-5 w-full" /><p className="mb-4 text-sm text-slate-500">Review your recording before saving it to this folder.</p><button className={primary} onClick={() => { const extension = recorded.type.includes('mp4') ? 'm4a' : recorded.type.includes('ogg') ? 'ogg' : 'webm'; upload([new window.File([recorded], `Recording ${new Date().toISOString().replace(/[:.]/g, '-')}.${extension}`, { type: recorded.type })]); setRecorded(undefined); }}>Save recording</button></Dialog>}
      <input ref={picker} type="file" multiple className="hidden" onChange={e => { if (e.target.files) upload(Array.from(e.target.files)); e.target.value = ''; }} />
      {loading && !files.length && !folders.length ? <div role="status" aria-label="Loading files" className="space-y-3">{[0, 1, 2, 3, 4].map(item => <div key={item} className="h-20 animate-pulse rounded-xl bg-slate-100" />)}</div> : <>
        {folders.length > 0 && <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">{folders.map(folder => <article key={folder.id} className="flex items-center rounded-2xl border border-slate-100 bg-[#EEF2FF] p-3"><button onClick={() => { if (section === 'trash') setActionFolder(folder); else { setQuery(''); setSearch(''); setPath(previous => [...previous, folder]); } }} className="flex min-w-0 flex-1 items-center gap-3 p-1 text-left"><Folder className="shrink-0 text-[#5B7CFF]" size={24} /><span className="min-w-0"><span className="block truncate text-sm font-medium">{folder.name}</span><span className="text-xs text-slate-500">{folder.total_file_count || 0} files</span></span></button><button aria-label={`Actions for folder ${folder.name}`} onClick={() => setActionFolder(folder)} className="rounded-lg p-2 text-slate-400 hover:bg-white"><MoreHorizontal size={18} /></button></article>)}</div>}
        {section === 'shared' ? <div className="space-y-3">{shares.map(share => <div key={share.id} className="flex items-center gap-4 rounded-xl border border-slate-100 bg-white p-4"><Share2 size={20} className="text-[#5B7CFF]" /><div className="flex-1"><p className="text-sm font-medium">{share.title || share.resource_type || 'Shared files'}</p><p className="text-xs text-slate-500">{share.expires_at ? `Expires ${new Date(share.expires_at).toLocaleDateString()}` : 'No expiration'}</p></div><button disabled={busy} className={secondary} onClick={() => void perform(() => api(`/api/v2/shares/${share.id}`, { method: 'DELETE' }), 'Link revoked')}>Revoke</button></div>)}</div> : <div className={grid ? 'grid grid-cols-2 gap-3 lg:grid-cols-4' : 'divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-100 bg-white'}>{files.map(file => <article key={file.id} className={grid ? 'rounded-2xl border border-slate-100 bg-white p-4' : 'flex items-center gap-3 px-4 py-3'}><button onClick={() => setPreview(file)} className={grid ? 'flex w-full flex-col items-start gap-3 text-left' : 'flex min-w-0 flex-1 items-center gap-3 text-left'}><Thumbnail file={file} /><span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{file.name}</span><span className="mt-1 block text-xs text-slate-500">{sizeLabel(Number(file.size))} · {new Date(file.created_at).toLocaleDateString()}</span></span>{file.is_starred && <Star aria-label="Starred" className="shrink-0 fill-amber-400 text-amber-400" size={16} />}</button><button aria-label={`Actions for ${file.name}`} onClick={() => setActionFile(file)} className="rounded-lg p-2 text-slate-400 hover:bg-slate-50"><MoreHorizontal size={19} /></button></article>)}</div>}
        {!files.length && !folders.length && (section !== 'shared' || !shares.length) && !error && <div className="rounded-2xl border border-dashed border-slate-200 px-6 py-16 text-center"><Folder className="mx-auto mb-4 text-[#5B7CFF]" size={36} /><h2 className="font-semibold">{search ? 'No matching files' : section === 'trash' ? 'Your trash is empty' : section === 'shared' ? 'No shared links yet' : 'Everything starts with a file'}</h2><p className="mt-2 text-sm text-slate-500">{section === 'files' ? 'Upload a file or drag it here to get started.' : 'Files will appear here when you add them.'}</p></div>}
        {files.length < total && <button className={`${secondary} mt-4`} disabled={loading} onClick={() => void load(true, files.length)}>{loading ? 'Loading…' : 'Load more'}</button>}
      </>}
      {!!tasks.length && <section className="mt-8 rounded-2xl border border-slate-100 bg-white p-5"><div className="mb-4 flex items-center justify-between"><h2 className="font-semibold">Transfers <span className="text-sm font-normal text-slate-400">{stats.completed} complete</span></h2><button className="text-sm text-[#5B7CFF]" onClick={clearCompleted}>Clear finished</button></div>{tasks.map(task => <div key={task.id} className="border-t border-slate-50 py-3"><div className="flex items-center gap-3"><p className="min-w-0 flex-1 truncate text-sm">{task.name}</p><span className="text-xs text-slate-500">{task.status === 'processing' ? 'Saving to Telegram' : task.status.replace('_', ' ')}</span>{['uploading', 'queued'].includes(task.status) && <button className="text-xs text-[#5B7CFF]" onClick={() => pauseTask(task.id)}>Pause</button>}{['paused', 'waiting_connection'].includes(task.status) && <button className="text-xs text-[#5B7CFF]" onClick={() => resumeTask(task.id)}>Resume</button>}{task.status === 'failed' && <button className="text-xs text-[#5B7CFF]" onClick={() => retryTask(task.id)}>Retry</button>}{!['completed', 'cancelled'].includes(task.status) && <button aria-label={`Cancel ${task.name}`} onClick={() => cancelTask(task.id)}><X size={15} /></button>}</div><div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[#EEF2FF]"><div className={`h-full rounded-full transition-[width] duration-150 ${task.status === 'failed' ? 'bg-red-500' : task.status === 'completed' ? 'bg-emerald-500' : 'bg-[#5B7CFF]'}`} style={{ width: `${Math.min(100, task.progress)}%` }} /></div>{task.error && <p className="mt-2 text-xs text-red-600">{task.error}</p>}</div>)}</section>}
    </main>
    <nav className="fixed inset-x-0 bottom-0 z-20 flex justify-around border-t border-slate-100 bg-white p-3 md:hidden">{[['files', Folder], ['starred', Star], ['shared', Share2], ['trash', Trash2]].map(([key, Icon]) => { const Component = Icon as typeof Folder; return <button key={key as string} aria-label={key as string} onClick={() => { setSection(key as string); setPath([]); setQuery(''); }} className={`rounded-xl p-3 ${section === key ? 'bg-[#EEF2FF] text-[#5B7CFF]' : 'text-slate-400'}`}><Component size={21} /></button>; })}<button aria-label="Storage settings" onClick={() => { setName(target); setForm('storage'); }} className="p-3"><HardDrive size={21} /></button></nav>
    {actionFile && !form && <Dialog title={actionFile.name} close={() => setActionFile(undefined)}><div className="grid gap-2"><a href={`${API_URL}/files/${actionFile.id}/download`} download className={secondary}>Download original</a>{section === 'trash' ? <button disabled={busy} className={secondary} onClick={() => void perform(() => mutate(`/files/${actionFile.id}/restore`, {}, 'PATCH'), 'File restored')}>Restore file</button> : <><button className={secondary} onClick={() => { setName(actionFile.name); setForm('rename'); }}>Rename</button><button className={secondary} onClick={() => { setMovePath([]); setForm('move'); }}>Move to folder</button><button disabled={busy} className={secondary} onClick={() => void perform(() => mutate(`/files/${actionFile.id}/star`, {}, 'PATCH'), actionFile.is_starred ? 'Removed from starred' : 'Added to starred')}>{actionFile.is_starred ? 'Remove star' : 'Add star'}</button><button className={secondary} onClick={() => { setShareUrl(''); setSharePassword(''); setForm('share'); }}>Share link</button><button disabled={busy} className={`${secondary} text-red-600`} onClick={() => void perform(() => mutate(`/files/${actionFile.id}/trash`, {}, 'PATCH'), 'Moved to trash. You can restore it from Trash.')}>Move to trash</button></>}</div></Dialog>}
    {actionFolder && !form && <Dialog title={actionFolder.name} close={() => setActionFolder(undefined)}><div className="grid gap-2">{section === 'trash' ? <button disabled={busy} className={secondary} onClick={() => void perform(() => mutate(`/files/${actionFolder.id}/restore`, {}, 'PATCH'), 'Folder restored')}>Restore folder</button> : <><button className={secondary} onClick={() => { setName(actionFolder.name); setForm('rename-folder'); }}>Rename folder</button><button disabled={busy} className={`${secondary} text-red-600`} onClick={() => void perform(() => api(`/files/folder/${actionFolder.id}`, { method: 'DELETE' }), 'Folder moved to trash')}>Move folder to trash</button></>}</div></Dialog>}
    {form && <Dialog title={form === 'folder' ? 'New folder' : form === 'rename' ? 'Rename file' : form === 'rename-folder' ? 'Rename folder' : form === 'move' ? 'Move file' : form === 'storage' ? 'Storage connection' : 'Share file'} close={closeForm}><form onSubmit={event => { event.preventDefault(); if (form === 'move' && actionFile) { void perform(() => mutate(`/files/${actionFile.id}`, { folder_id: movePath.at(-1)?.id || null }, 'PATCH'), 'File moved'); } else if (form === 'rename-folder' && actionFolder) { void perform(() => mutate(`/files/folder/${actionFolder.id}`, { name }, 'PATCH'), 'Folder renamed'); } else if (form === 'storage') { setTarget(name.trim() || 'me'); localStorage.setItem(`axya-storage-${user.id}`, name.trim() || 'me'); closeForm(); setNotice('Storage target updated for new uploads'); } else if (form === 'share' && actionFile) { void perform(async () => { const data = await mutate('/api/v2/shares', { resource_type: 'file', root_file_id: actionFile.id, allow_download: true, allow_preview: true, password: sharePassword || undefined, expires_at: new Date(Date.now() + Number(expiryDays) * 86400000).toISOString() }); const link = data.share_url || data.shareUrl; if (!link) throw new Error('The server did not return a share link'); setShareUrl(link); }, 'Share link created'); } else { void perform(() => form === 'folder' ? mutate('/files/folder', { name, parent_id: folderId || null }) : mutate(`/files/${actionFile?.id}`, { file_name: name }, 'PATCH'), form === 'folder' ? 'Folder created' : 'File renamed'); } }} className="space-y-4">
      {form === 'move' ? <><p className="text-sm text-slate-500">Destination: {movePath.map(folder => folder.name).join(' / ') || 'My files'}</p><div className="flex gap-3"><button type="button" className="text-sm text-[#5B7CFF]" onClick={() => setMovePath([])}>My files</button>{!!movePath.length && <button type="button" className="text-sm text-[#5B7CFF]" onClick={() => setMovePath(previous => previous.slice(0, -1))}>Parent folder</button>}</div><div className="max-h-64 overflow-auto">{moveFolders.map(folder => <button key={folder.id} type="button" className={`${secondary} mb-2 flex w-full items-center gap-3 text-left`} onClick={() => setMovePath(previous => [...previous, folder])}><Folder size={18} />{folder.name}</button>)}</div></> : form === 'share' ? <><p className="text-sm text-slate-500">Anyone with this link and its password can preview and download this file until it expires.</p><label className="block text-sm">Expiration<select value={expiryDays} onChange={event => setExpiryDays(event.target.value)} className="mt-2 w-full rounded-xl border p-3"><option value="1">1 day</option><option value="7">7 days</option><option value="30">30 days</option></select></label><label className="block text-sm">Password (optional)<input type="password" value={sharePassword} onChange={event => setSharePassword(event.target.value)} className="mt-2 w-full rounded-xl border p-3" /></label></> : <label className="block text-sm font-medium">{form === 'storage' ? 'Private channel ID or Saved Messages' : 'Name'}<input autoFocus required maxLength={255} value={name} onChange={event => setName(event.target.value)} className="mt-2 w-full rounded-xl border border-slate-200 p-3" /></label>}
      {form === 'storage' && <><p className="text-sm leading-6 text-slate-500">Use “me” for your Saved Messages, or the ID of a private channel your Telegram account can access. This applies to new uploads.</p><button type="button" className="text-sm text-slate-500" onClick={() => void perform(async () => { await mutate('/auth/logout'); signedOut(); }, 'Signed out')}>Sign out of Axya</button></>}
      <button disabled={busy} className={primary}>{busy ? 'Saving…' : form === 'share' ? 'Create link' : 'Save'}</button></form></Dialog>}
    {shareUrl && !form && <Dialog title="Your share link" close={() => setShareUrl('')}><p className="mb-4 text-sm text-slate-500">Send this link to your friends. You can revoke it from Shared links.</p><input readOnly aria-label="Share link" value={shareUrl} onFocus={event => event.target.select()} className="w-full rounded-xl border p-3 text-sm" /><button className={`${primary} mt-4`} onClick={() => void navigator.clipboard.writeText(shareUrl).then(() => setNotice('Link copied')).catch(() => setNotice('Select the link above and copy it manually'))}>Copy link</button></Dialog>}
    {preview && <Dialog title={preview.name} close={() => setPreview(undefined)}><MediaPreview key={preview.id} file={preview} /><a className={`${secondary} mt-5 inline-flex items-center gap-2`} href={`${API_URL}/files/${preview.id}/download`} download><Download size={16} />Download original</a></Dialog>}
  </div>;
}
