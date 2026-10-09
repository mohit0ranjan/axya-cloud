import { useSyncExternalStore } from 'react';
import { AccessibilityInfo } from 'react-native';

let reduced = true;
const listeners = new Set<() => void>();
let subscription: ReturnType<typeof AccessibilityInfo.addEventListener> | undefined;
let generation = 0;
const update = (value: boolean) => {
    reduced = value;
    listeners.forEach(listener => listener());
};
const subscribe = (listener: () => void) => {
    listeners.add(listener);
    if (!subscription) {
        const current = ++generation;
        subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', update);
        void AccessibilityInfo.isReduceMotionEnabled().then(value => {
            if (current === generation) update(value);
        }).catch(() => update(true));
    }
    return () => {
        listeners.delete(listener);
        if (!listeners.size) {
            generation++;
            subscription?.remove();
            subscription = undefined;
        }
    };
};
export const useReducedMotion = () => useSyncExternalStore(subscribe, () => reduced, () => true);
