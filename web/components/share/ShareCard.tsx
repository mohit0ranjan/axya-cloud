import React from 'react';
import { ShareMeta } from './types';
import { DownloadCloud, FolderOpen, Calendar, ShieldCheck } from 'lucide-react';

interface ShareCardProps {
    share: ShareMeta;
    onDownloadAll?: () => void;
    downloading?: boolean;
}

export function ShareCard({ share, onDownloadAll, downloading }: ShareCardProps) {
    const isFolder = share.resourceType === 'folder';

    return (
        <div className="relative overflow-hidden mb-8 rounded-2xl bg-white/70 p-6 shadow-card backdrop-blur-xl border border-white space-y-4">

            {/* Background Decorator */}
            <div className="absolute -top-24 -right-24 h-48 w-48 rounded-full bg-brand-start/5 blur-3xl pointer-events-none" />
            <div className="absolute -bottom-24 -left-24 h-48 w-48 rounded-full bg-brand-accent-end/10 blur-3xl pointer-events-none" />

            <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">

                {/* Left Side: Share Details */}
                <div className="space-y-2">
                    <div className="flex items-center gap-3">
                        <div className="flex p-3 rounded-xl bg-brand-light text-brand-dark">
                            {isFolder ? <FolderOpen className="w-6 h-6 text-brand-start" /> : <ShieldCheck className="w-6 h-6 text-brand-start" />}
                        </div>
                        <div>
                            <h2 className="text-2xl font-semibold text-brand-text">
                                {isFolder ? 'Shared Workspace' : 'Shared File'}
                            </h2>
                            <div className="flex items-center text-sm text-brand-muted gap-4 mt-1">
                                <span className="flex items-center gap-1">
                                    <Calendar className="w-4 h-4" />
                                    Shared securely via AXYA
                                </span>
                                {share.requiresPassword && (
                                    <span className="flex items-center gap-1 text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full text-xs font-medium">
                                        Password Protected
                                    </span>
                                )}
                            </div>
                        </div>
                    </div>
                </div>

                {/* Right Side: Primary Action */}
                {share.allowDownload && onDownloadAll && (
                    <button
                        onClick={onDownloadAll}
                        disabled={downloading}
                        className={`
              flex items-center justify-center gap-2 px-6 py-3.5 rounded-xl font-medium text-white shadow-lg transition-all duration-300
              ${downloading
                                ? 'bg-neutral-400 cursor-not-allowed opacity-80'
                                : 'bg-gradient-to-r from-brand-start to-brand-end hover:shadow-xl hover:shadow-brand-start/30 hover:-translate-y-0.5 active:translate-y-0 shadow-brand-start/20'
                            }
            `}
                    >
                        {downloading ? (
                            <div className="h-5 w-5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                        ) : (
                            <DownloadCloud className="w-5 h-5" />
                        )}

                        <span>{downloading ? 'Preparing zip...' : `Download ${isFolder ? 'Folder' : 'File'}`}</span>
                    </button>
                )}
            </div>
        </div>
    );
}
