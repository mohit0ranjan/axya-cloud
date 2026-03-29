import React, { useEffect } from 'react';
import { SharedFile, ShareMeta } from './types';
import { isVideo, isImage, isPdf, formatSize, getFileLabel, cn } from '../../lib/utils';
import { File, FileText, Film, Image as ImageIcon, Download, Maximize2 } from 'lucide-react';
import Skeleton from 'react-loading-skeleton';
import 'react-loading-skeleton/dist/skeleton.css';
import { useViewportGate } from './useViewportGate';

interface FileCardProps {
    file: SharedFile;
    share: ShareMeta;
    onPreview: (file: SharedFile) => void;
    onDownload: (file: SharedFile) => void;
    ticketMap: Record<string, boolean>;
    previewUrlMap: Record<string, string>;
    onLoadThumbnail: (file: SharedFile) => void;
}

function FileCardComponent({ file, share, onPreview, onDownload, ticketMap, previewUrlMap, onLoadThumbnail }: FileCardProps) {
    const isImg = isImage(file);
    const isVid = isVideo(file);
    const isDoc = isPdf(file);
    const isDownloading = ticketMap[`${file.id}:attachment`];
    const [thumbFailed, setThumbFailed] = React.useState(false);
    const { ref, isVisible } = useViewportGate<HTMLDivElement>({ rootMargin: '320px' });

    const previewUrl = previewUrlMap[`${file.id}:thumbnail`] || previewUrlMap[`${file.id}:inline`];
    const fetchAttempted = React.useRef(false);

    useEffect(() => {
        if ((isImg || isDoc) && isVisible && !previewUrl && !fetchAttempted.current) {
            fetchAttempted.current = true;
            onLoadThumbnail(file);
        }
    }, [file, isDoc, isImg, isVisible, previewUrl, onLoadThumbnail]);

    useEffect(() => {
        fetchAttempted.current = false;
        setThumbFailed(false);
    }, [file.id]);

    // Decide which icon to show
    let Icon = File;
    if (isImg) Icon = ImageIcon;
    if (isVid) Icon = Film;
    if (isDoc) Icon = FileText;

    return (
        <div
            ref={ref}
            className="group relative flex flex-col bg-white rounded-2xl border border-neutral-100 shadow-sm hover:shadow-card overflow-hidden transition-all duration-300"
        >
            {/* Thumbnail Area */}
            <div
                className="relative bg-brand-light/40 aspect-[4/3] flex items-center justify-center overflow-hidden cursor-pointer"
                onClick={() => onPreview(file)}
            >
                <div className="absolute inset-0 bg-gradient-to-t from-black/5 to-transparent z-0 opacity-0 group-hover:opacity-100 transition-opacity" />

                {(isImg || isDoc) && ticketMap[`${file.id}:thumbnail`] ? (
                    <Skeleton className="absolute inset-0 w-full h-full" containerClassName="w-full h-full leading-none" />
                ) : previewUrl && !thumbFailed && isVisible ? (
                    <img
                        src={previewUrl}
                        alt={getFileLabel(file)}
                        loading="lazy"
                        decoding="async"
                        fetchPriority="low"
                        className="absolute inset-0 w-full h-full object-cover transition-transform duration-500 group-hover:scale-110"
                        onError={() => setThumbFailed(true)}
                    />
                ) : (
                    <Icon className={cn(
                        "w-12 h-12 z-10 transition-transform duration-300 group-hover:scale-110",
                        isImg ? "text-amber-500" : isVid ? "text-purple-500" : isDoc ? "text-red-500" : "text-brand-start"
                    )} />
                )}

                {/* Hover Actions: Center */}
                <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/10 backdrop-blur-[2px] z-20">
                    <button
                        type="button"
                        onClick={(e) => {
                            e.stopPropagation();
                            onPreview(file);
                        }}
                        className="flex items-center gap-2 px-4 py-2 bg-white/90 rounded-full text-brand-text text-sm font-medium shadow-sm hover:bg-white hover:scale-105 transition-transform"
                    >
                        <Maximize2 className="w-4 h-4" /> Preview
                    </button>
                </div>
            </div>

            {/* Details Area */}
            <div className="p-4 flex flex-col gap-1 border-t border-neutral-50 bg-white z-10">
                <h3 className="text-sm font-medium text-brand-text truncate" title={getFileLabel(file)}>
                    {getFileLabel(file)}
                </h3>
                <p className="text-xs text-brand-muted">
                    {formatSize(file.size_bytes)}
                </p>

                {/* Download Button Component overlayed slightly or at bottom right */}
                {share.allowDownload && (
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            onDownload(file);
                        }}
                        disabled={isDownloading}
                        className="absolute bottom-3 right-3 p-2 rounded-full bg-brand-light/50 text-brand-start hover:bg-brand-start hover:text-white transition-colors disabled:opacity-50"
                        title="Download file"
                    >
                        {isDownloading ? (
                            <div className="w-4 h-4 border-2 border-brand-start border-t-transparent rounded-full animate-spin" />
                        ) : (
                            <Download className="w-4 h-4" />
                        )}
                    </button>
                )}
            </div>
        </div>
    );
}

export const FileCard = React.memo(FileCardComponent, (prev, next) => {
    const fileKeys = [
        prev.file.id === next.file.id,
        prev.file.display_name === next.file.display_name,
        prev.file.size_bytes === next.file.size_bytes,
        prev.file.mime_type === next.file.mime_type,
        prev.file.relative_path === next.file.relative_path,
    ];

    const thumbKey = `${next.file.id}:thumbnail`;
    const inlineKey = `${next.file.id}:inline`;
    const attachKey = `${next.file.id}:attachment`;

    return fileKeys.every(Boolean)
        && prev.share.allowDownload === next.share.allowDownload
        && prev.previewUrlMap[thumbKey] === next.previewUrlMap[thumbKey]
        && prev.previewUrlMap[inlineKey] === next.previewUrlMap[inlineKey]
        && prev.ticketMap[thumbKey] === next.ticketMap[thumbKey]
        && prev.ticketMap[attachKey] === next.ticketMap[attachKey]
        && prev.onPreview === next.onPreview
        && prev.onDownload === next.onDownload
        && prev.onLoadThumbnail === next.onLoadThumbnail;
});
