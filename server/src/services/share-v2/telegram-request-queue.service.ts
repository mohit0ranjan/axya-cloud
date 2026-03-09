import PQueue from 'p-queue';
import pool from '../../config/db';

type QueuePriority = 'interactive' | 'background';

type QueueRunOptions<T> = {
    sessionHash: string;
    operation: string;
    priority: QueuePriority;
    task: () => Promise<T>;
};

type SessionQueueState = {
    queue: PQueue;
    cooldownUntil: number;
    failures: number;
};

const sessionQueues = new Map<string, SessionQueueState>();

const toPriorityWeight = (priority: QueuePriority): number => (priority === 'interactive' ? 10 : 1);

const parseFloodWaitSeconds = (message: string): number | null => {
    const upper = String(message || '').toUpperCase();
    if (!upper.includes('FLOOD_WAIT')) return null;
    const num = upper.match(/FLOOD_WAIT_?(\d+)/)?.[1] || upper.match(/(\d+)/)?.[1];
    const sec = Number.parseInt(String(num || ''), 10);
    if (!Number.isFinite(sec) || sec <= 0) return null;
    return Math.min(sec, 15 * 60);
};

const getOrCreateSessionQueue = (sessionHash: string): SessionQueueState => {
    const existing = sessionQueues.get(sessionHash);
    if (existing) return existing;

    const queue = new PQueue({
        concurrency: 1,
        intervalCap: Number.parseInt(String(process.env.TELEGRAM_QUEUE_INTERVAL_CAP || '8'), 10) || 8,
        interval: Number.parseInt(String(process.env.TELEGRAM_QUEUE_INTERVAL_MS || '1000'), 10) || 1000,
        carryoverConcurrencyCount: true,
    });

    const created: SessionQueueState = {
        queue,
        cooldownUntil: 0,
        failures: 0,
    };

    sessionQueues.set(sessionHash, created);
    return created;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const recordQueueMetric = async (row: {
    sessionHash: string;
    operation: string;
    priority: QueuePriority;
    waitMs: number;
    runMs: number;
    status: 'ok' | 'error';
    errorCode: string | null;
}) => {
    try {
        await pool.query(
            `INSERT INTO telegram_request_queue_metrics (
                session_hash, operation_name, priority, wait_ms, run_ms, status, error_code
            ) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
            [
                row.sessionHash,
                row.operation,
                row.priority,
                row.waitMs,
                row.runMs,
                row.status,
                row.errorCode,
            ]
        );
    } catch {
        // best effort metrics
    }
};

export const runTelegramQueued = async <T>(options: QueueRunOptions<T>): Promise<T> => {
    const state = getOrCreateSessionQueue(options.sessionHash);
    const enqueuedAt = Date.now();

    return state.queue.add(async () => {
        const waitMs = Date.now() - enqueuedAt;

        const cooldownMs = Math.max(0, state.cooldownUntil - Date.now());
        if (cooldownMs > 0) {
            await sleep(cooldownMs);
        }

        const startedAt = Date.now();
        try {
            const result = await options.task();
            state.failures = 0;
            await recordQueueMetric({
                sessionHash: options.sessionHash,
                operation: options.operation,
                priority: options.priority,
                waitMs,
                runMs: Date.now() - startedAt,
                status: 'ok',
                errorCode: null,
            });
            return result;
        } catch (err: any) {
            state.failures += 1;

            const raw = String(err?.message || '');
            const floodWaitSeconds = parseFloodWaitSeconds(raw);
            if (floodWaitSeconds) {
                state.cooldownUntil = Date.now() + (floodWaitSeconds + 1) * 1000;
            } else if (state.failures >= 3) {
                state.cooldownUntil = Date.now() + 5000;
            }

            await recordQueueMetric({
                sessionHash: options.sessionHash,
                operation: options.operation,
                priority: options.priority,
                waitMs,
                runMs: Date.now() - startedAt,
                status: 'error',
                errorCode: floodWaitSeconds ? 'flood_wait' : 'telegram_error',
            });

            throw err;
        }
    }, { priority: toPriorityWeight(options.priority) });
};

export const getTelegramQueueHealth = () => {
    const now = Date.now();

    const sessions = Array.from(sessionQueues.entries()).map(([sessionHash, state]) => ({
        sessionHash,
        pending: state.queue.size,
        running: state.queue.pending,
        failures: state.failures,
        cooldownMs: Math.max(0, state.cooldownUntil - now),
    }));

    return {
        sessionCount: sessions.length,
        sessions,
    };
};
