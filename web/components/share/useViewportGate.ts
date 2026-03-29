import { useEffect, useRef, useState } from 'react';

type ViewportGateOptions = {
    rootMargin?: string;
    threshold?: number;
    once?: boolean;
};

export function useViewportGate<T extends Element>({
    rootMargin = '280px',
    threshold = 0.01,
    once = true,
}: ViewportGateOptions = {}) {
    const ref = useRef<T | null>(null);
    const [isVisible, setIsVisible] = useState(false);

    useEffect(() => {
        const node = ref.current;
        if (!node) return;

        if (typeof window === 'undefined' || typeof IntersectionObserver === 'undefined') {
            setIsVisible(true);
            return;
        }

        const observer = new IntersectionObserver(
            (entries) => {
                const entry = entries[0];
                if (!entry) return;
                if (entry.isIntersecting) {
                    setIsVisible(true);
                    if (once) observer.disconnect();
                } else if (!once) {
                    setIsVisible(false);
                }
            },
            { rootMargin, threshold }
        );

        observer.observe(node);

        return () => {
            observer.disconnect();
        };
    }, [once, rootMargin, threshold]);

    return { ref, isVisible };
}