/**
 * useServerKeepAlive.ts
 *
 * Pings the Render backend every 10 minutes to prevent cold starts.
 * Render free tier sleeps after 15 minutes of inactivity.
 * This hook fires when the app is foregrounded, so it only runs
 * when the user is actively using the app.
 */

import { useEffect, useRef } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import apiClient from '../services/apiClient';
import { uploadManager } from '../services/UploadManager';
import { serverReadiness } from '../services/serverReadiness';

const PING_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes

export function useServerKeepAlive() {
    const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const appStateRef = useRef<AppStateStatus>('active');
    const pingInFlightRef = useRef(false);

    const ping = async () => {
        const stats = uploadManager.getStats();
        if (stats.activeCount > 0 || serverReadiness.isWakeInProgress()) {
            return;
        }

        if (pingInFlightRef.current) return;
        pingInFlightRef.current = true;
        try {
            await apiClient.get('/health', { _maxRetries: 0 } as any);
            console.log('🏓 [KeepAlive] Server pinged successfully');
        } catch {
            // Silent — server might be waking. apiClient already shows the overlay.
        } finally {
            pingInFlightRef.current = false;
        }
    };

    const startPinging = () => {
        stopPinging();
        // Ping immediately on foreground
        ping();
        // Then every 10 minutes
        intervalRef.current = setInterval(ping, PING_INTERVAL_MS);
    };

    const stopPinging = () => {
        if (intervalRef.current) {
            clearInterval(intervalRef.current);
            intervalRef.current = null;
        }
    };

    useEffect(() => {
        // Start pinging when component mounts (app active)
        startPinging();

        const subscription = AppState.addEventListener('change', (nextState: AppStateStatus) => {
            const prev = appStateRef.current;
            appStateRef.current = nextState;

            if (nextState === 'active' && prev !== 'active') {
                // App came to foreground — restart pinging
                startPinging();
            } else if (nextState !== 'active') {
                // App went to background — stop pinging to save battery
                stopPinging();
            }
        });

        return () => {
            stopPinging();
            subscription.remove();
        };
    }, []);
}
