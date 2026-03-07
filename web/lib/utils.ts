import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import { SharedFile } from "../components/share/types";

export function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs));
}

export const formatSize = (bytes: number) => {
    if (!bytes) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
    return `${(bytes / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
};

export const isImage = (file: SharedFile) => String(file.mime_type || '').startsWith('image/');
export const isVideo = (file: SharedFile) => String(file.mime_type || '').startsWith('video/');
export const isPdf = (file: SharedFile) => String(file.mime_type || '').toLowerCase() === 'application/pdf';
export const supportsInlinePreview = (file: SharedFile) => isImage(file) || isVideo(file) || isPdf(file);
export const getFileLabel = (file: SharedFile) => String(file.display_name || file.relative_path || 'Untitled file').trim() || 'Untitled file';

export const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return new Intl.DateTimeFormat('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric'
    }).format(date);
};
