import { useEffect } from 'react';
import { SharedFile } from './types';

type UsePreviewWarmupOptions = {
    enabled: boolean;
    files: SharedFile[];
    currentIndex: number;
    onWarmPreview: (file: SharedFile) => void;
};

export function usePreviewWarmup({ enabled, files, currentIndex, onWarmPreview }: UsePreviewWarmupOptions) {
    useEffect(() => {
        if (!enabled || files.length === 0) return;

        const targets = [
            files[currentIndex],
            files[currentIndex + 1],
            files[currentIndex - 1],
        ].filter(Boolean) as SharedFile[];

        if (targets.length === 0) return;

        let cancelled = false;
        const hasIdleCallback = typeof window !== 'undefined' && 'requestIdleCallback' in window;
        const schedule = hasIdleCallback
            ? (window as Window & {
                requestIdleCallback: any;
            }).requestIdleCallback(() => {
                if (cancelled) return;
                targets.forEach(onWarmPreview);
            }, { timeout: 800 })
            : globalThis.setTimeout(() => {
                if (cancelled) return;
                targets.forEach(onWarmPreview);
            }, 0);

        return () => {
            cancelled = true;
            if (hasIdleCallback && typeof schedule === 'number' && 'cancelIdleCallback' in window) {
                (window as Window & {
                    cancelIdleCallback: any;
                }).cancelIdleCallback(schedule);
            } else {
                globalThis.clearTimeout(schedule as ReturnType<typeof globalThis.setTimeout>);
            }
        };
    }, [enabled, files, currentIndex, onWarmPreview]);
}