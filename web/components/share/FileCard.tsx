import React, { useEffect } from 'react';
import { SharedFile, ShareMeta } from './types';
import { isVideo, isImage, isPdf, formatSize, getFileLabel, cn } from '../../lib/utils';
import { File, FileText, Film, Image as ImageIcon, Download, Maximize2 } from 'lucide-react';
import { LazyLoadImage } from 'react-lazy-load-image-component';
import Skeleton from 'react-loading-skeleton';
import 'react-loading-skeleton/dist/skeleton.css';

interface FileCardProps {
    file: SharedFile;
    share: ShareMeta;
    onClick: () => void;
    onDownload: (e: React.MouseEvent) => void;
    ticketMap: Record<string, boolean>;
    previewUrlMap: Record<string, string>;
    onLoadThumbnail: (file: SharedFile) => void;
}

export const FileCard = React.memo(({ file, share, onClick, onDownload, ticketMap, previewUrlMap, onLoadThumbnail }: FileCardProps) => {
    const isImg = isImage(file);
    const isVid = isVideo(file);
    const isDoc = isPdf(file);
    const isDownloading = ticketMap[`${file.id}:attachment`];
    const [thumbFailed, setThumbFailed] = React.useState(false);

    const previewUrl = previewUrlMap[`${file.id}:thumbnail`] || previewUrlMap[`${file.id}:inline`];
    const fetchAttempted = React.useRef(false);

    useEffect(() => {
        if ((isImg || isDoc) && !previewUrl && !fetchAttempted.current) {
            fetchAttempted.current = true;
            onLoadThumbnail(file);
        }
    }, [isDoc, isImg, file, previewUrl, onLoadThumbnail]);

    // Decide which icon to show
    let Icon = File;
    if (isImg) Icon = ImageIcon;
    if (isVid) Icon = Film;
    if (isDoc) Icon = FileText;

    return (
        <div
            className="group relative flex flex-col bg-white rounded-2xl border border-neutral-100 shadow-sm hover:shadow-card overflow-hidden transition-all duration-300"
        >
            {/* Thumbnail Area */}
            <div
                className="relative bg-brand-light/40 aspect-[4/3] flex items-center justify-center overflow-hidden cursor-pointer"
                onClick={onClick}
            >
                <div className="absolute inset-0 bg-gradient-to-t from-black/5 to-transparent z-0 opacity-0 group-hover:opacity-100 transition-opacity" />

                {(isImg || isDoc) && ticketMap[`${file.id}:thumbnail`] ? (
                    <Skeleton className="absolute inset-0 w-full h-full" containerClassName="w-full h-full leading-none" />
                ) : previewUrl && !thumbFailed ? (
                    <LazyLoadImage
                        src={previewUrl}
                        alt={getFileLabel(file)}
                        className="absolute inset-0 w-full h-full object-cover transition-transform duration-500 group-hover:scale-110"
                        wrapperClassName="w-full h-full absolute inset-0"
                        effect="opacity"
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
                            onClick();
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
                        onClick={onDownload}
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
});
