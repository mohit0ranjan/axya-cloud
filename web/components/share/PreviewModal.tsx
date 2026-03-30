import React, { useEffect, useState, useCallback } from 'react';
import { SharedFile, ShareMeta } from './types';
import { X, ChevronLeft, ChevronRight, Download, Info, Share2, RefreshCw } from 'lucide-react';
import { formatSize, getFileLabel, isImage, isPdf, isVideo, supportsInlinePreview } from '../../lib/utils';

interface PreviewModalProps {
    isOpen: boolean;
    onClose: () => void;
    files: SharedFile[];
    currentIndex: number;
    onNext: () => void;
    onPrev: () => void;
    onDownload: (file: SharedFile) => void;
    onShare?: (file: SharedFile) => void;
    share: ShareMeta;
    previewUrlMap: Record<string, string>;
    previewErrors?: Record<string, string>;
    onLoadPreview: (file: SharedFile) => void;
    onPreviewMediaError?: (file: SharedFile) => void;
}

export function PreviewModal({
    isOpen, onClose, files, currentIndex, onNext, onPrev, onDownload, onShare, share, previewUrlMap, previewErrors, onLoadPreview, onPreviewMediaError
}: PreviewModalProps) {
    const [imageLoaded, setImageLoaded] = useState(false);
    const [animateIn, setAnimateIn] = useState(false);

    // Close on Escape key
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
            if (e.key === 'ArrowRight') onNext();
            if (e.key === 'ArrowLeft') onPrev();
        };
        if (isOpen) window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isOpen, onClose, onNext, onPrev]);

    const currentFile = files[currentIndex] || null;

    useEffect(() => {
        if (isOpen && currentFile) {
            setImageLoaded(false);
            onLoadPreview(currentFile);
        }
    }, [isOpen, currentFile, onLoadPreview]);

    // Animate modal entrance
    useEffect(() => {
        if (isOpen) {
            requestAnimationFrame(() => setAnimateIn(true));
        } else {
            setAnimateIn(false);
        }
    }, [isOpen]);

    // Reset image loaded state when changing files
    useEffect(() => {
        setImageLoaded(false);
    }, [currentIndex]);

    const handleRetry = useCallback(() => {
        if (currentFile) {
            setImageLoaded(false);
            onLoadPreview(currentFile);
        }
    }, [currentFile, onLoadPreview]);

    if (!isOpen || !files.length || currentIndex < 0 || currentIndex >= files.length) return null;

    const previewUrl = previewUrlMap[`${currentFile.id}:inline`];
    const thumbUrl = previewUrlMap[`${currentFile.id}:thumbnail`];
    const previewError = previewErrors?.[currentFile.id] || '';
    const canInlinePreview = supportsInlinePreview(currentFile);

    const renderContent = () => {
        if (!canInlinePreview) {
            return (
                <div className="bg-white p-12 rounded-2xl shadow-xl flex flex-col items-center gap-4 text-center animate-fadeInUp">
                    <div className="w-20 h-20 bg-brand-light rounded-2xl flex items-center justify-center text-brand-start">
                        <Info className="w-10 h-10" />
                    </div>
                    <div>
                        <h3 className="text-xl font-semibold text-brand-text mb-1">Preview not available</h3>
                        <p className="text-brand-muted max-w-sm mx-auto">
                            This file type cannot be previewed directly in the browser. Please download it to view.
                        </p>
                    </div>
                </div>
            );
        }

        if (previewError) {
            return (
                <div className="bg-white p-12 rounded-2xl shadow-xl flex flex-col items-center gap-4 text-center animate-fadeInUp">
                    <div className="w-20 h-20 bg-red-50 rounded-2xl flex items-center justify-center text-red-500">
                        <Info className="w-10 h-10" />
                    </div>
                    <div>
                        <h3 className="text-xl font-semibold text-brand-text mb-1">Preview unavailable</h3>
                        <p className="text-brand-muted max-w-sm mx-auto">{previewError}</p>
                        <button
                            onClick={handleRetry}
                            className="mt-5 inline-flex items-center gap-2 justify-center rounded-lg bg-brand-start px-4 py-2 text-sm font-medium text-white hover:opacity-90 transition-opacity"
                        >
                            <RefreshCw className="w-4 h-4" />
                            Retry preview
                        </button>
                    </div>
                </div>
            );
        }

        if (!previewUrl) {
            return (
                <div className="flex flex-col items-center justify-center p-12">
                    {/* Progressive: show thumbnail blurred while full loads */}
                    {thumbUrl ? (
                        <div className="relative max-h-[85vh] max-w-[90vw] rounded-xl overflow-hidden shadow-2xl">
                            <img
                                src={thumbUrl}
                                alt={getFileLabel(currentFile)}
                                className="max-h-[85vh] max-w-[90vw] object-contain blur-md scale-105 brightness-90"
                            />
                            <div className="absolute inset-0 flex items-center justify-center">
                                <div className="w-10 h-10 border-3 border-white/80 border-t-transparent rounded-full animate-spin" />
                            </div>
                        </div>
                    ) : (
                        <>
                            {/* Skeleton placeholder with shimmer */}
                            <div className="relative w-80 h-60 rounded-xl overflow-hidden bg-neutral-800/50 shadow-2xl">
                                <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/5 to-transparent animate-shimmer bg-[length:200%_100%]" />
                                <div className="absolute inset-0 flex items-center justify-center">
                                    <div className="w-10 h-10 border-3 border-white/60 border-t-transparent rounded-full animate-spin" />
                                </div>
                            </div>
                            <p className="text-white/60 font-medium mt-4 text-sm">Loading preview…</p>
                        </>
                    )}
                </div>
            );
        }

        if (isImage(currentFile)) {
            return (
                <div className="relative">
                    {/* Blurred thumbnail underneath for progressive loading */}
                    {thumbUrl && !imageLoaded && (
                        <img
                            src={thumbUrl}
                            alt=""
                            aria-hidden
                            className="max-h-[85vh] max-w-[90vw] object-contain rounded-xl blur-md scale-105 brightness-90"
                        />
                    )}
                    <img
                        src={previewUrl}
                        alt={getFileLabel(currentFile)}
                        className={`max-h-[85vh] max-w-[90vw] object-contain rounded-xl shadow-2xl transition-all duration-500 ${
                            thumbUrl && !imageLoaded ? 'absolute inset-0' : ''
                        } ${imageLoaded ? 'opacity-100 blur-0' : thumbUrl ? 'opacity-0' : 'opacity-0 blur-sm'}`}
                        onLoad={() => setImageLoaded(true)}
                        onError={() => onPreviewMediaError?.(currentFile)}
                    />
                </div>
            );
        }
        if (isVideo(currentFile)) {
            return (
                <video
                    src={previewUrl}
                    controls
                    className="max-h-[85vh] max-w-[90vw] rounded-xl shadow-2xl"
                    autoPlay
                    poster={thumbUrl || undefined}
                    onError={() => onPreviewMediaError?.(currentFile)}
                />
            );
        }
        if (isPdf(currentFile)) {
            return (
                <object
                    data={previewUrl}
                    type="application/pdf"
                    className="h-[85vh] w-[90vw] rounded-xl bg-white shadow-2xl"
                    aria-label={getFileLabel(currentFile)}
                >
                    <div className="flex h-[85vh] w-[90vw] items-center justify-center rounded-xl bg-white p-8 text-center text-brand-muted shadow-2xl">
                        <div className="max-w-sm">
                            <h3 className="text-xl font-semibold text-brand-text mb-2">PDF preview unavailable</h3>
                            <p>
                                The browser could not render this PDF inline. Use download if the preview does not appear.
                            </p>
                        </div>
                    </div>
                </object>
            );
        }
        return null;
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
            {/* Backdrop */}
            <div
                className={`absolute inset-0 bg-neutral-900/90 backdrop-blur-md transition-opacity duration-300 ${animateIn ? 'opacity-100' : 'opacity-0'}`}
                onClick={onClose}
            />

            {/* Header Bar */}
            <div className={`absolute top-0 left-0 right-0 h-20 bg-gradient-to-b from-black/50 to-transparent flex items-center justify-between px-6 z-10 transition-all duration-300 ${animateIn ? 'translate-y-0 opacity-100' : '-translate-y-4 opacity-0'}`}>
                <div className="flex flex-col text-white">
                    <span className="font-medium text-lg truncate max-w-[60vw]" title={getFileLabel(currentFile)}>
                        {getFileLabel(currentFile)}
                    </span>
                    <span className="text-sm text-white/70">
                        {formatSize(currentFile.size_bytes)}
                        {files.length > 1 && ` · ${currentIndex + 1} of ${files.length}`}
                    </span>
                </div>

                <div className="flex items-center gap-4">
                    {onShare && (
                        <button
                            onClick={() => onShare(currentFile)}
                            className="flex items-center gap-2 px-4 py-2 bg-white/10 hover:bg-white/20 rounded-lg text-white font-medium transition-colors"
                        >
                            <Share2 className="w-4 h-4" />
                            <span>Share</span>
                        </button>
                    )}
                    {share.allowDownload && (
                        <button
                            onClick={() => onDownload(currentFile)}
                            className="flex items-center gap-2 px-4 py-2 bg-white/10 hover:bg-white/20 rounded-lg text-white font-medium transition-colors"
                        >
                            <Download className="w-4 h-4" />
                            <span>Download</span>
                        </button>
                    )}
                    <button
                        onClick={onClose}
                        className="p-2 bg-white/10 hover:bg-white/20 rounded-full text-white transition-colors"
                    >
                        <X className="w-6 h-6" />
                    </button>
                </div>
            </div>

            {/* Navigation Areas */}
            {files.length > 1 && (
                <>
                    <button
                        onClick={onPrev}
                        className="absolute left-6 top-1/2 -translate-y-1/2 p-3 bg-black/20 hover:bg-black/40 rounded-full text-white backdrop-blur-md transition-all z-10 hidden sm:block disabled:opacity-30 disabled:cursor-not-allowed"
                        disabled={currentIndex === 0}
                    >
                        <ChevronLeft className="w-8 h-8" />
                    </button>

                    <button
                        onClick={onNext}
                        className="absolute right-6 top-1/2 -translate-y-1/2 p-3 bg-black/20 hover:bg-black/40 rounded-full text-white backdrop-blur-md transition-all z-10 hidden sm:block disabled:opacity-30 disabled:cursor-not-allowed"
                        disabled={currentIndex === files.length - 1}
                    >
                        <ChevronRight className="w-8 h-8" />
                    </button>
                </>
            )}

            {/* Main Content Area */}
            <div className={`relative z-0 max-h-screen max-w-screen p-4 flex items-center justify-center transition-all duration-300 ${animateIn ? 'scale-100 opacity-100' : 'scale-95 opacity-0'}`}>
                {renderContent()}
            </div>

            {/* CSS animations */}
            <style jsx>{`
                @keyframes shimmer {
                    0% { background-position: 200% 0; }
                    100% { background-position: -200% 0; }
                }
                .animate-shimmer {
                    animation: shimmer 1.5s ease-in-out infinite;
                }
                @keyframes fadeInUp {
                    from { opacity: 0; transform: translateY(12px); }
                    to { opacity: 1; transform: translateY(0); }
                }
                .animate-fadeInUp {
                    animation: fadeInUp 0.3s ease-out;
                }
            `}</style>
        </div>
    );
}
