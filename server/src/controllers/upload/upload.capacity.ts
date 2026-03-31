import fs from 'fs';
import pool from '../../config/db';
import { toInt, clamp } from './upload.helpers';
import {
    CapacitySnapshot,
    AdaptiveLimits,
    DiskUsageSnapshot,
    UploadLifecycleStatus,
    UPLOAD_TMP_ROOT,
    TMP_USAGE_SOFT_LIMIT_BYTES,
    DISK_PAUSE_THRESHOLD_PERCENT,
    DISK_CRITICAL_THRESHOLD_PERCENT,
    RESERVED_DISK_BYTES,
    MAX_GLOBAL_ACTIVE_UPLOADS,
    SAFE_ACTIVE_UPLOADS_GLOBAL,
    SAFE_ACTIVE_UPLOADS_PER_USER,
    BURST_ACTIVE_UPLOADS_GLOBAL,
    BURST_ACTIVE_UPLOADS_PER_USER,
    QUEUE_POLL_MS_MIN,
    QUEUE_POLL_MS_MAX,
    PROCESSING_POLL_MS_MIN,
    PROCESSING_POLL_MS_MAX,
    CHUNK_DELAY_MS_MIN,
    CHUNK_DELAY_MS_MAX,
    getTmpUsageCache,
    setTmpUsageCache,
} from './upload.types';

// ─── Disk usage ─────────────────────────────────────────────────────────────

export const sumDirBytes = (targetPath: string): number => {
    let total = 0;
    try {
        const entries = fs.readdirSync(targetPath, { withFileTypes: true });
        for (const entry of entries) {
            const entryPath = `${targetPath}/${entry.name}`;
            if (entry.isDirectory()) {
                total += sumDirBytes(entryPath);
            } else if (entry.isFile()) {
                total += fs.statSync(entryPath).size;
            }
        }
    } catch {
        return total;
    }
    return total;
};

export const getUploadTmpUsageBytes = () => {
    const now = Date.now();
    const cache = getTmpUsageCache();
    if (now - cache.at < 10_000) return cache.bytes;
    const bytes = sumDirBytes(UPLOAD_TMP_ROOT);
    setTmpUsageCache(bytes, now);
    return bytes;
};

export const getDiskUsageSnapshot = (): DiskUsageSnapshot => {
    try {
        fs.mkdirSync(UPLOAD_TMP_ROOT, { recursive: true });
        const statfsSync = (fs as any).statfsSync as undefined | ((target: string) => any);
        if (typeof statfsSync === 'function') {
            const stat = statfsSync(UPLOAD_TMP_ROOT);
            const blockSize = Math.max(1, Number(stat?.bsize || 0));
            const totalBlocks = Math.max(0, Number(stat?.blocks || 0));
            const availableBlocks = Math.max(0, Number(stat?.bavail || 0));
            const totalBytes = totalBlocks * blockSize;
            const availableBytes = Math.min(totalBytes, availableBlocks * blockSize);
            const usedPercent = totalBytes > 0
                ? Math.max(0, Math.min(100, ((totalBytes - availableBytes) / totalBytes) * 100))
                : 0;
            return {
                totalBytes,
                availableBytes,
                usedPercent,
                source: 'statfs',
            };
        }
    } catch {
        // fall through to estimate mode
    }

    const usedBytes = getUploadTmpUsageBytes();
    const syntheticTotalBytes = Math.max(TMP_USAGE_SOFT_LIMIT_BYTES, usedBytes + 1);
    const availableBytes = Math.max(0, syntheticTotalBytes - usedBytes);
    return {
        totalBytes: syntheticTotalBytes,
        availableBytes,
        usedPercent: (usedBytes / syntheticTotalBytes) * 100,
        source: 'estimate',
    };
};

// ─── Capacity ───────────────────────────────────────────────────────────────

export const getCapacitySnapshot = async (userId: string): Promise<CapacitySnapshot> => {
    const result = await pool.query(
        `SELECT
            COUNT(*) FILTER (WHERE status IN ('uploading', 'processing'))::int AS active_global,
            COUNT(*) FILTER (WHERE status = 'queued')::int AS queued_global,
            COUNT(*) FILTER (WHERE user_id = $1 AND status IN ('uploading', 'processing'))::int AS active_user,
            COUNT(*) FILTER (WHERE user_id = $1 AND status = 'queued')::int AS queued_user
         FROM upload_sessions`,
        [userId]
    );

    const row = result.rows[0] || {};
    return {
        activeGlobal: toInt(row.active_global),
        activeForUser: toInt(row.active_user),
        queuedGlobal: toInt(row.queued_global),
        queuedForUser: toInt(row.queued_user),
    };
};

export const getAdaptiveConcurrencyLimits = (capacity: CapacitySnapshot): AdaptiveLimits => {
    const memory = process.memoryUsage();
    const heapRatio = memory.heapTotal > 0 ? (memory.heapUsed / memory.heapTotal) : 0;
    const rssMb = Math.round(memory.rss / (1024 * 1024));
    const disk = getDiskUsageSnapshot();
    const diskUsageMb = Math.round((disk.totalBytes - disk.availableBytes) / (1024 * 1024));
    const diskUsagePercent = Number(disk.usedPercent.toFixed(2));
    const availableDiskMb = Math.round(disk.availableBytes / (1024 * 1024));
    const diskPauseNewUploads = diskUsagePercent >= DISK_PAUSE_THRESHOLD_PERCENT || disk.availableBytes < RESERVED_DISK_BYTES;
    const diskCritical = diskUsagePercent >= DISK_CRITICAL_THRESHOLD_PERCENT || disk.availableBytes < Math.round(RESERVED_DISK_BYTES * 0.5);
    const diskPressure: 'normal' | 'high' = diskPauseNewUploads ? 'high' : 'normal';

    const lowLoad = heapRatio < 0.68
        && rssMb < 360
        && diskPressure === 'normal'
        && capacity.queuedGlobal === 0
        && capacity.activeGlobal <= SAFE_ACTIVE_UPLOADS_GLOBAL;

    const perUserLimit = diskPauseNewUploads
        ? 0
        : (lowLoad ? BURST_ACTIVE_UPLOADS_PER_USER : SAFE_ACTIVE_UPLOADS_PER_USER);
    const globalLimit = diskPauseNewUploads
        ? 0
        : (lowLoad ? BURST_ACTIVE_UPLOADS_GLOBAL : SAFE_ACTIVE_UPLOADS_GLOBAL);

    return {
        perUserLimit,
        globalLimit,
        lowLoad,
        diskPressure,
        diskUsageMb,
        diskUsagePercent,
        diskPauseNewUploads,
        diskCritical,
        availableDiskMb,
        rssMb,
    };
};

// ─── Backpressure hints ─────────────────────────────────────────────────────

export const getQueuePollMs = (activeGlobal: number, queueDepth: number) => {
    const pressure = clamp((activeGlobal / MAX_GLOBAL_ACTIVE_UPLOADS) + (queueDepth / 30), 0, 1);
    return Math.round(QUEUE_POLL_MS_MIN + ((QUEUE_POLL_MS_MAX - QUEUE_POLL_MS_MIN) * pressure));
};

export const getProcessingPollMs = (activeGlobal: number, queueDepth: number) => {
    const pressure = clamp((activeGlobal / MAX_GLOBAL_ACTIVE_UPLOADS) + (queueDepth / 40), 0, 1);
    return Math.round(PROCESSING_POLL_MS_MIN + ((PROCESSING_POLL_MS_MAX - PROCESSING_POLL_MS_MIN) * pressure));
};

export const getRecommendedChunkDelayMs = (activeGlobal: number, queueDepth: number) => {
    const pressure = clamp((activeGlobal / MAX_GLOBAL_ACTIVE_UPLOADS) + (queueDepth / 25), 0, 1);
    return Math.round(CHUNK_DELAY_MS_MIN + ((CHUNK_DELAY_MS_MAX - CHUNK_DELAY_MS_MIN) * pressure));
};

export const buildBackpressureHints = (status: UploadLifecycleStatus | string, capacity: CapacitySnapshot) => {
    const memory = process.memoryUsage();
    const heapRatio = memory.heapTotal > 0 ? (memory.heapUsed / memory.heapTotal) : 0;
    const limits = getAdaptiveConcurrencyLimits(capacity);
    const rssMb = limits.rssMb;
    const memoryPressure = heapRatio >= 0.86 || rssMb >= 430 ? 'high'
        : heapRatio >= 0.72 || rssMb >= 340 ? 'medium'
            : 'low';

    let recommendedChunkDelayMs = getRecommendedChunkDelayMs(capacity.activeGlobal, capacity.queuedGlobal);
    let recommendedPollMs = status === 'queued'
        ? getQueuePollMs(capacity.activeGlobal, capacity.queuedGlobal)
        : status === 'processing'
            ? getProcessingPollMs(capacity.activeGlobal, capacity.queuedGlobal)
            : getQueuePollMs(Math.max(0, capacity.activeGlobal - 1), Math.max(0, capacity.queuedGlobal - 1));

    if (memoryPressure === 'high') {
        recommendedChunkDelayMs = Math.max(recommendedChunkDelayMs, 120);
        recommendedPollMs = Math.max(recommendedPollMs, 6000);
    } else if (memoryPressure === 'medium') {
        recommendedChunkDelayMs = Math.max(recommendedChunkDelayMs, 60);
        recommendedPollMs = Math.max(recommendedPollMs, 4200);
    }

    if (limits.diskPauseNewUploads) {
        recommendedChunkDelayMs = Math.max(recommendedChunkDelayMs, 120);
        recommendedPollMs = Math.max(recommendedPollMs, 7000);
    }

    const capacityLevel = capacity.activeGlobal >= limits.globalLimit
        ? 'high'
        : capacity.activeGlobal >= Math.max(1, limits.globalLimit - 1)
            ? 'medium'
            : 'low';
    const level = memoryPressure === 'high' || capacityLevel === 'high' || limits.diskPressure === 'high'
        ? 'high'
        : memoryPressure === 'medium' || capacityLevel === 'medium'
            ? 'medium'
            : 'low';

    return {
        backpressure: {
            level,
            activeGlobal: capacity.activeGlobal,
            queuedGlobal: capacity.queuedGlobal,
            memoryPressure,
            rssMb,
            diskPressure: limits.diskPressure,
            diskUsageMb: limits.diskUsageMb,
            diskUsagePercent: limits.diskUsagePercent,
            availableDiskMb: limits.availableDiskMb,
            diskPauseNewUploads: limits.diskPauseNewUploads,
            activeGlobalLimit: limits.globalLimit,
            activePerUserLimit: limits.perUserLimit,
        },
        recommendedChunkDelayMs,
        recommendedPollMs,
    };
};
