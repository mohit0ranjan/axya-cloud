'use client';
import { useState } from 'react';
import { API_URL } from '../../lib/urls';

export function MediaPreview({ file }: { file: { id: string; name: string; mime_type: string } }) {
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const source = `${API_URL}/files/${encodeURIComponent(file.id)}/stream?attempt=${attempt}`;
  const media = /^(image|video|audio)\//.test(file.mime_type) || file.mime_type === 'application/pdf';
  const retry = () => { setReady(false); setFailed(false); setAttempt(value => value + 1); };
  if (!media) return <p className="py-10 text-center text-slate-500">Download this file to open it in a compatible app.</p>;
  return <div className="relative min-h-24">
    {!ready && !failed && <p role="status" className="mb-4 rounded-xl bg-[#EEF2FF] p-4 text-sm text-[#5B7CFF]">Preparing preview… Large files may take a moment.</p>}
    {failed ? <div role="alert" className="rounded-xl bg-slate-50 p-5 text-sm"><p>We could not play this preview. Try again, or download the original to open it on your device.</p><button onClick={retry} className="mt-4 text-[#5B7CFF]">Retry preview</button></div> :
      file.mime_type.startsWith('image/') ? <img key={attempt} src={source} alt={file.name} onLoad={() => setReady(true)} onError={() => setFailed(true)} className="mx-auto max-h-[65dvh] object-contain" /> :
      file.mime_type.startsWith('video/') ? <video key={attempt} controls playsInline preload="metadata" src={source} onLoadedData={() => setReady(true)} onWaiting={() => setReady(false)} onPlaying={() => setReady(true)} onError={() => setFailed(true)} className="max-h-[65dvh] w-full" /> :
      file.mime_type.startsWith('audio/') ? <audio key={attempt} controls preload="metadata" src={source} onLoadedMetadata={() => setReady(true)} onError={() => setFailed(true)} className="w-full" /> :
      <iframe key={attempt} title={file.name} src={source} onLoad={() => setReady(true)} className="h-[65dvh] w-full" />}
  </div>;
}
