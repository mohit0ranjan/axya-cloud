import React from 'react';
import { ShareMeta } from './types';
import { formatSize } from '../../lib/utils'; // We will create this or inline it

interface ShareHeaderProps {
    share: ShareMeta | null;
    totalSizeText?: string;
}

export function ShareHeader({ share, totalSizeText }: ShareHeaderProps) {
    return (
        <header className="flex items-center justify-between py-4 px-6 mb-6">
            {/* Brand Logo */}
            <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-brand-start to-brand-end text-white shadow-lg shadow-brand-start/20">
                    <svg
                        xmlns="http://www.w3.org/2000/svg"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className="h-6 w-6"
                        width="24"
                        height="24"
                    >
                        <path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242" />
                        <path d="M12 12v9" />
                        <path d="m8 17 4-4 4 4" />
                    </svg>
                </div>
                <div>
                    <h1 className="text-xl font-bold tracking-tight text-brand-text">AXYA <span className="text-brand-start">SHARE</span></h1>
                </div>
            </div>

            {/* Share Info Badge */}
            {share && (
                <div className="hidden sm:flex items-center gap-4 text-sm font-medium text-brand-muted bg-white/60 px-4 py-2 rounded-full border border-white/40 shadow-sm backdrop-blur-md">
                    <div className="flex items-center gap-1.5">
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" /><polyline points="14 2 14 8 20 8" /></svg>
                        <span>{share.fileCount} file{share.fileCount !== 1 ? 's' : ''}</span>
                    </div>
                    {totalSizeText && (
                        <>
                            <div className="h-4 w-[1px] bg-gray-200" />
                            <span>{totalSizeText}</span>
                        </>
                    )}
                </div>
            )}
        </header>
    );
}
