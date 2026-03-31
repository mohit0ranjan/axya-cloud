import React, { useCallback } from 'react';
import { SharedFile, ShareMeta } from './types';
import { FileCard } from './FileCard';
import { VirtuosoGrid } from 'react-virtuoso';

interface FileGridProps {
    files: SharedFile[];
    share: ShareMeta;
    onPreview: (file: SharedFile) => void;
    onDownload: (file: SharedFile) => void;
    ticketMap: Record<string, boolean>;
    previewUrlMap: Record<string, string>;
    onLoadThumbnail: (file: SharedFile) => void;
    onEndReached?: () => void;
}

function FileGridComponent({ files, share, onPreview, onDownload, ticketMap, previewUrlMap, onLoadThumbnail, onEndReached }: FileGridProps) {
const renderItem = useCallback((index: number, file: SharedFile, context: any) => {
        return (
            <div className="w-full">
                <FileCard
                    file={file}
                    share={context.share}
                    onPreview={context.onPreview}
                    onDownload={context.onDownload}
                    ticketMap={context.ticketMap}
                    previewUrlMap={context.previewUrlMap}
                    onLoadThumbnail={context.onLoadThumbnail}
                />
            </div>
        );
    }, []);

    if (!files || files.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center py-20 px-4 text-center">
                <div className="w-24 h-24 mb-6 rounded-3xl bg-brand-light flex items-center justify-center shadow-inner">
                    <svg className="w-10 h-10 text-brand-start/50" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
                    </svg>
                </div>
                <h3 className="text-lg font-semibold text-brand-text">No files available</h3>
                <p className="text-sm text-brand-muted mt-2 max-w-sm mx-auto">
                    This share does not contain any files or they might have been removed.
                </p>
            </div>
        );
    }

    return (
        <VirtuosoGrid
            useWindowScroll
            data={files}
            endReached={onEndReached}
            overscan={140}
            listClassName="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4 sm:gap-6"
            itemClassName="flex" // Ensures item fills the grid cell properly
            itemContent={renderItem}
        />
    );
}

export const FileGrid = React.memo(FileGridComponent);
