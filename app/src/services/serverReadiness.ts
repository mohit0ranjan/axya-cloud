import { API_URL as API_BASE } from '../config/urls';

export type ServerReadinessPhase = 'idle' | 'waking' | 'ready' | 'timeout';

export interface ServerReadinessState {
    phase: ServerReadinessPhase;
    isWaking: boolean;
    statusText: string;
    startedAt: number | null;
    timedOutAt: number | null;
    lastError?: string;
}

interface WaitOptions {
    maxWaitMs?: number;
    pollIntervalMs?: number;
    reason?: string;
}

const DEFAULT_MAX_WAIT_MS = 40_000;
const DEFAULT_POLL_INTERVAL_MS = 2_500;
const HEALTH_REQUEST_TIMEOUT_MS = 8_000;
const WAKE_BANNER_TEXT = 'Waking server... uploads will start shortly';
const WAKE_TIMEOUT_TEXT = 'Server is still waking. Tap retry to keep uploads queued.';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const toPathname = (urlOrPath?: string, baseUrl?: string) => {
    const raw = String(urlOrPath || '').trim();
    if (!raw) return '/';

    try {
        if (raw.startsWith('http://') || raw.startsWith('https://')) {
            return new URL(raw).pathname;
        }
        const base = String(baseUrl || API_BASE || '').trim() || 'https://axya-server.onrender.com';
        return new URL(raw, base).pathname;
    } catch {
        return raw.startsWith('/') ? raw : `/${raw}`;
    }
};

const isHealthPath = (urlOrPath?: string, baseUrl?: string) => {
    const pathname = toPathname(urlOrPath, baseUrl);
    return pathname === '/health' || pathname === '/health/';
};

const normalizeStatus = (value: unknown) => String(value || '').trim().toLowerCase();

class ServerReadinessManager {
    private state: ServerReadinessState = {
        phase: 'idle',
        isWaking: false,
        statusText: WAKE_BANNER_TEXT,
        startedAt: null,
        timedOutAt: null,
    };

    private listeners: Array<(state: ServerReadinessState) => void> = [];
    private waitPromise: Promise<boolean> | null = null;
    private readyCallbacks = new Set<() => void>();

    public subscribe(listener: (state: ServerReadinessState) => void): () => void {
        this.listeners.push(listener);
        listener(this.getState());
        return () => {
            this.listeners = this.listeners.filter((l) => l !== listener);
        };
    }

    public getState(): ServerReadinessState {
        return { ...this.state };
    }

    public isReady(): boolean {
        return this.state.phase === 'ready';
    }

    public isWakeInProgress(): boolean {
        return this.state.phase === 'waking' || this.state.phase === 'timeout';
    }

    public shouldAllowRequest(urlOrPath?: string, baseUrl?: string): boolean {
        if (!this.isWakeInProgress()) return true;
        return isHealthPath(urlOrPath, baseUrl);
    }

    public async waitUntilReady(options: WaitOptions = {}): Promise<boolean> {
        if (this.state.phase === 'ready') return true;
        if (this.waitPromise) return this.waitPromise;

        const maxWaitMs = Math.max(5_000, Number(options.maxWaitMs || DEFAULT_MAX_WAIT_MS));
        const pollIntervalMs = Math.max(1_500, Number(options.pollIntervalMs || DEFAULT_POLL_INTERVAL_MS));

        this.waitPromise = this.pollUntilReady(maxWaitMs, pollIntervalMs, String(options.reason || '').trim())
            .finally(() => {
                this.waitPromise = null;
            });

        return this.waitPromise;
    }

    public async retryWake(): Promise<boolean> {
        return this.waitUntilReady({
            maxWaitMs: DEFAULT_MAX_WAIT_MS,
            pollIntervalMs: DEFAULT_POLL_INTERVAL_MS,
            reason: 'manual_retry',
        });
    }

    public runWhenReady(callback: () => void): void {
        if (this.state.phase === 'ready') {
            callback();
            return;
        }
        this.readyCallbacks.add(callback);
        void this.waitUntilReady({ reason: 'deferred_task' });
    }

    private async pollUntilReady(maxWaitMs: number, pollIntervalMs: number, reason: string): Promise<boolean> {
        const startedAt = Date.now();
        this.setState({
            phase: 'waking',
            isWaking: true,
            statusText: WAKE_BANNER_TEXT,
            startedAt,
            timedOutAt: null,
            lastError: reason ? `wake_reason:${reason}` : undefined,
        });

        const deadline = startedAt + maxWaitMs;
        while (Date.now() < deadline) {
            const isReady = await this.checkStrictHealthReadiness();
            if (isReady) {
                this.setState({
                    phase: 'ready',
                    isWaking: false,
                    statusText: WAKE_BANNER_TEXT,
                    startedAt: null,
                    timedOutAt: null,
                    lastError: undefined,
                });
                this.flushReadyCallbacks();
                return true;
            }

            const remainingMs = Math.max(0, deadline - Date.now());
            if (remainingMs === 0) break;
            this.setState({
                phase: 'waking',
                isWaking: true,
                statusText: `${WAKE_BANNER_TEXT} (${Math.max(1, Math.ceil(remainingMs / 1000))}s)`,
                startedAt,
            });
            await sleep(Math.min(pollIntervalMs, remainingMs));
        }

        this.setState({
            phase: 'timeout',
            isWaking: true,
            statusText: WAKE_TIMEOUT_TEXT,
            timedOutAt: Date.now(),
            lastError: 'wake_timeout',
        });
        return false;
    }

    private async checkStrictHealthReadiness(): Promise<boolean> {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), HEALTH_REQUEST_TIMEOUT_MS);

        try {
            const response = await fetch(`${API_BASE}/health?deep=1`, {
                method: 'GET',
                signal: controller.signal,
                headers: {
                    Accept: 'application/json',
                },
            });

            if (!response.ok) return false;
            const data = await response.json();

            const status = normalizeStatus(data?.status);
            const schema = normalizeStatus(data?.checks?.schema);
            const db = normalizeStatus(data?.checks?.db);
            const explicitReady = data?.readyForUploads;

            if (typeof explicitReady === 'boolean') {
                return explicitReady;
            }

            return status === 'ok' && schema === 'ready' && db === 'ok';
        } catch {
            return false;
        } finally {
            clearTimeout(timeoutId);
        }
    }

    private flushReadyCallbacks() {
        const callbacks = Array.from(this.readyCallbacks);
        this.readyCallbacks.clear();
        callbacks.forEach((callback) => {
            try {
                callback();
            } catch {
                // no-op; deferred callbacks are best-effort only
            }
        });
    }

    private setState(next: Partial<ServerReadinessState>) {
        this.state = {
            ...this.state,
            ...next,
        };
        const snapshot = this.getState();
        this.listeners.forEach((listener) => listener(snapshot));
    }
}

export const serverReadiness = new ServerReadinessManager();

export const SERVER_WAKE_BANNER_TEXT = WAKE_BANNER_TEXT;

export const isHealthRequestPath = (urlOrPath?: string, baseUrl?: string) => isHealthPath(urlOrPath, baseUrl);
