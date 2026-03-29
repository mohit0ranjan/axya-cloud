import React, { useEffect } from 'react';
import { SharedFile, ShareMeta } from './types';
import { X, ChevronLeft, ChevronRight, Download, Info, Share2 } from 'lucide-react';
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
            onLoadPreview(currentFile);
        }
    }, [isOpen, currentFile, onLoadPreview]);

    if (!isOpen || !files.length || currentIndex < 0 || currentIndex >= files.length) return null;

    const previewUrl = previewUrlMap[`${currentFile.id}:inline`];
    const previewError = previewErrors?.[currentFile.id] || '';
    const canInlinePreview = supportsInlinePreview(currentFile);

    const renderContent = () => {
        if (!canInlinePreview) {
            return (
                <div className="bg-white p-12 rounded-2xl shadow-xl flex flex-col items-center gap-4 text-center">
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
                <div className="bg-white p-12 rounded-2xl shadow-xl flex flex-col items-center gap-4 text-center">
                    <div className="w-20 h-20 bg-red-50 rounded-2xl flex items-center justify-center text-red-500">
                        <Info className="w-10 h-10" />
                    </div>
                    <div>
                        <h3 className="text-xl font-semibold text-brand-text mb-1">Preview unavailable</h3>
                        <p className="text-brand-muted max-w-sm mx-auto">{previewError}</p>
                        <button
                            onClick={() => onLoadPreview(currentFile)}
                            className="mt-5 inline-flex items-center justify-center rounded-lg bg-brand-start px-4 py-2 text-sm font-medium text-white hover:opacity-90"
                        >
                            Retry preview
                        </button>
                    </div>
                </div>
            );
        }

        if (!previewUrl) {
            return (
                <div className="flex flex-col items-center justify-center p-12">
                    <div className="w-12 h-12 border-4 border-brand-start border-t-white rounded-full animate-spin shadow-lg mb-6" />
                    <p className="text-white font-medium drop-shadow-md">Loading secure preview...</p>
                </div>
            );
        }

        if (isImage(currentFile)) {
            return (
                <img
                    src={previewUrl}
                    alt={getFileLabel(currentFile)}
                    className="max-h-[85vh] max-w-[90vw] object-contain rounded-xl shadow-2xl transition-transform duration-300"
                    onError={() => onPreviewMediaError?.(currentFile)}
                />
            );
        }
        if (isVideo(currentFile)) {
            return (
                <video
                    src={previewUrl}
                    controls
                    className="max-h-[85vh] max-w-[90vw] rounded-xl shadow-2xl"
                    autoPlay
                    onError={() => onPreviewMediaError?.(currentFile)}
                />
            );
        }
        if (isPdf(currentFile)) {
            return (
                <iframe
                    src={previewUrl}
                    title={getFileLabel(currentFile)}
                    className="h-[85vh] w-[90vw] rounded-xl bg-white shadow-2xl"
                    onError={() => onPreviewMediaError?.(currentFile)}
                />
            );
        }
        return null;
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
            {/* Backdrop */}
            <div
                className="absolute inset-0 bg-neutral-900/90 backdrop-blur-md transition-opacity"
                onClick={onClose}
            />

            {/* Header Bar */}
            <div className="absolute top-0 left-0 right-0 h-20 bg-gradient-to-b from-black/50 to-transparent flex items-center justify-between px-6 z-10 transition-transform">
                <div className="flex flex-col text-white">
                    <span className="font-medium text-lg truncate max-w-[60vw]" title={getFileLabel(currentFile)}>
                        {getFileLabel(currentFile)}
                    </span>
                    <span className="text-sm text-white/70">
                        {formatSize(currentFile.size_bytes)}
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
            <div className="relative z-0 max-h-screen max-w-screen p-4 flex items-center justify-center">
                {renderContent()}
            </div>
        </div>
    );
}
