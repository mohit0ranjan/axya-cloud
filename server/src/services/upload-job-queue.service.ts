import PQueue from 'p-queue';

const parseEnvInt = (raw: unknown, fallback: number, min: number, max: number): number => {
	const parsed = Number.parseInt(String(raw ?? ''), 10);
	const safe = Number.isFinite(parsed) ? parsed : fallback;
	return Math.max(min, Math.min(max, safe));
};

const FINALIZER_QUEUE_CONCURRENCY = parseEnvInt(process.env.UPLOAD_FINALIZER_QUEUE_CONCURRENCY, 2, 1, 8);
const FINALIZER_INTERVAL_CAP = parseEnvInt(process.env.UPLOAD_FINALIZER_INTERVAL_CAP, 6, 1, 30);
const FINALIZER_INTERVAL_MS = parseEnvInt(process.env.UPLOAD_FINALIZER_INTERVAL_MS, 1000, 100, 60_000);
const UPLOAD_MAX_BYTES_PER_SEC = parseEnvInt(process.env.UPLOAD_MAX_BYTES_PER_SEC, 8 * 1024 * 1024, 256 * 1024, 256 * 1024 * 1024);

const finalizerQueue = new PQueue({
	concurrency: FINALIZER_QUEUE_CONCURRENCY,
	intervalCap: FINALIZER_INTERVAL_CAP,
	interval: FINALIZER_INTERVAL_MS,
	carryoverConcurrencyCount: true,
});

const trackedUploadIds = new Set<string>();

type BandwidthState = {
	windowStart: number;
	bytesInWindow: number;
	lastSeenAt: number;
};
const bandwidthByUser = new Map<string, BandwidthState>();
const BANDWIDTH_IDLE_TTL_MS = parseEnvInt(process.env.UPLOAD_BW_STATE_TTL_MS, 10 * 60 * 1000, 60_000, 6 * 60 * 60 * 1000);
const BANDWIDTH_MAX_TRACKED_USERS = parseEnvInt(process.env.UPLOAD_BW_STATE_MAX_USERS, 5000, 100, 100_000);

let lastBandwidthCleanupAt = 0;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const getBandwidthDelayMs = (userKey: string, incomingBytes: number): number => {
	const now = Date.now();
	const state = bandwidthByUser.get(userKey) || { windowStart: now, bytesInWindow: 0, lastSeenAt: now };

	if (now - state.windowStart >= 1000) {
		state.windowStart = now;
		state.bytesInWindow = 0;
	}
	state.lastSeenAt = now;

	state.bytesInWindow += Math.max(0, incomingBytes);
	bandwidthByUser.set(userKey, state);

	if (state.bytesInWindow <= UPLOAD_MAX_BYTES_PER_SEC) return 0;

	const overflow = state.bytesInWindow - UPLOAD_MAX_BYTES_PER_SEC;
	const delayMs = Math.ceil((overflow / UPLOAD_MAX_BYTES_PER_SEC) * 1000);
	return Math.max(0, Math.min(delayMs, 3000));
};

const cleanupBandwidthState = (now = Date.now()) => {
	if (now - lastBandwidthCleanupAt < 60_000) return;
	lastBandwidthCleanupAt = now;

	for (const [key, value] of bandwidthByUser.entries()) {
		if (now - value.lastSeenAt > BANDWIDTH_IDLE_TTL_MS) {
			bandwidthByUser.delete(key);
		}
	}

	if (bandwidthByUser.size <= BANDWIDTH_MAX_TRACKED_USERS) return;

	const entries = Array.from(bandwidthByUser.entries());
	entries.sort((a, b) => a[1].lastSeenAt - b[1].lastSeenAt);
	const toDrop = Math.max(0, entries.length - BANDWIDTH_MAX_TRACKED_USERS);
	for (let i = 0; i < toDrop; i += 1) {
		bandwidthByUser.delete(entries[i][0]);
	}
};

export const withUploadBandwidthBudget = async (userId: string, bytes: number): Promise<void> => {
	cleanupBandwidthState();
	const key = String(userId || 'anonymous').trim() || 'anonymous';
	const delayMs = getBandwidthDelayMs(key, bytes);
	if (delayMs > 0) await sleep(delayMs);
};

export const getUploadBandwidthStateHealth = () => {
	cleanupBandwidthState();
	return {
		trackedUsers: bandwidthByUser.size,
		idleTtlMs: BANDWIDTH_IDLE_TTL_MS,
		maxTrackedUsers: BANDWIDTH_MAX_TRACKED_USERS,
	};
};

export const enqueueUploadFinalizerJob = (uploadId: string, task: () => Promise<void>): Promise<void> | null => {
	const normalized = String(uploadId || '').trim();
	if (!normalized) return null;
	if (trackedUploadIds.has(normalized)) return null;

	trackedUploadIds.add(normalized);
	return finalizerQueue.add(async () => {
		try {
			await task();
		} finally {
			trackedUploadIds.delete(normalized);
		}
	});
};

export const isUploadFinalizerTracked = (uploadId: string): boolean => {
	const normalized = String(uploadId || '').trim();
	if (!normalized) return false;
	return trackedUploadIds.has(normalized);
};

export const getUploadFinalizerQueueHealth = () => ({
	concurrency: FINALIZER_QUEUE_CONCURRENCY,
	intervalCap: FINALIZER_INTERVAL_CAP,
	intervalMs: FINALIZER_INTERVAL_MS,
	maxUploadBytesPerSec: UPLOAD_MAX_BYTES_PER_SEC,
	queued: finalizerQueue.size,
	running: finalizerQueue.pending,
	tracked: trackedUploadIds.size,
	bandwidth: getUploadBandwidthStateHealth(),
});
