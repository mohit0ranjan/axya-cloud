import path from 'path';
import os from 'os';

// ─── Env helpers ────────────────────────────────────────────────────────────

export const parseEnvIntInRange = (raw: unknown, fallback: number, min: number, max: number): number => {
    const parsed = Number.parseInt(String(raw ?? ''), 10);
    const value = Number.isFinite(parsed) ? parsed : fallback;
    return Math.max(min, Math.min(max, value));
};

// ─── Types ──────────────────────────────────────────────────────────────────

export type UploadLifecycleStatus = 'queued' | 'uploading' | 'processing' | 'paused' | 'completed' | 'cancelled' | 'failed';

export type UploadSessionRow = {
    upload_id: string;
    user_id: string;
    file_name: string;
    mime_type: string | null;
    folder_id: string | null;
    telegram_chat_id: string;
    source_tag: string | null;
    upload_protocol: string | null;
    total_bytes: string | number;
    chunk_size_bytes: number;
    total_chunks: number;
    uploaded_chunks: unknown;
    received_bytes: string | number;
    status: UploadLifecycleStatus;
    telegram_progress_percent: number;
    file_id: string | null;
    file_sha256: string | null;
    file_md5: string | null;
    temp_file_path: string;
    error_code: string | null;
    error_message: string | null;
    retryable: boolean;
    created_at: string;
    updated_at: string;
    completed_at: string | null;
};

export type UploadChunkStats = {
    uploadedCount: number;
    uploadedBytes: number;
    uploadedChunks: number[];
};

export type UploadManifestIntegrity = {
    valid: boolean;
    missingChunks: number[];
    invalidChunkSizes: Array<{ chunkIndex: number; expected: number; actual: number }>;
    uploadedCount: number;
    expectedCount: number;
    uploadedBytes: number;
    expectedBytes: number;
};

export type CapacitySnapshot = {
    activeGlobal: number;
    activeForUser: number;
    queuedGlobal: number;
    queuedForUser: number;
};

export type AdaptiveLimits = {
    perUserLimit: number;
    globalLimit: number;
    lowLoad: boolean;
    diskPressure: 'normal' | 'high';
    diskUsageMb: number;
    diskUsagePercent: number;
    diskPauseNewUploads: boolean;
    diskCritical: boolean;
    availableDiskMb: number;
    rssMb: number;
};

export type DiskUsageSnapshot = {
    totalBytes: number;
    availableBytes: number;
    usedPercent: number;
    source: 'statfs' | 'estimate';
};

// ─── Semaphore ──────────────────────────────────────────────────────────────

export class Semaphore {
    private running = 0;
    private queue: Array<() => void> = [];
    constructor(private max: number) { }
    async acquire(): Promise<() => void> {
        if (this.running < this.max) {
            this.running++;
            return () => this.release();
        }
        return new Promise<() => void>(resolve => {
            this.queue.push(() => {
                this.running++;
                resolve(() => this.release());
            });
        });
    }
    private release() {
        this.running--;
        if (this.queue.length > 0) {
            const next = this.queue.shift()!;
            next();
        }
    }
}

// ─── Constants ──────────────────────────────────────────────────────────────

export const UPLOAD_TMP_ROOT = path.join(os.tmpdir(), 'axya_uploads');
export const FIXED_CHUNK_SIZE_BYTES = 5 * 1024 * 1024;

export const DISK_PAUSE_THRESHOLD_PERCENT = Math.max(50, Math.min(99, Number.parseFloat(String(process.env.UPLOAD_DISK_PAUSE_PERCENT || '80'))));
export const DISK_CRITICAL_THRESHOLD_PERCENT = Math.max(60, Math.min(99.9, Number.parseFloat(String(process.env.UPLOAD_DISK_CRITICAL_PERCENT || '92'))));
export const RESERVED_DISK_BYTES = Number.parseInt(String(process.env.UPLOAD_DISK_RESERVED_BYTES || String(150 * 1024 * 1024)), 10) || (150 * 1024 * 1024);

export const SAFE_ACTIVE_UPLOADS_PER_USER = parseEnvIntInRange(process.env.UPLOAD_SAFE_ACTIVE_PER_USER, 2, 1, 5);
export const BURST_ACTIVE_UPLOADS_PER_USER = Math.max(
    SAFE_ACTIVE_UPLOADS_PER_USER,
    parseEnvIntInRange(process.env.UPLOAD_BURST_ACTIVE_PER_USER, 3, 1, 5)
);
export const SAFE_ACTIVE_UPLOADS_GLOBAL = parseEnvIntInRange(process.env.UPLOAD_SAFE_ACTIVE_GLOBAL, 3, 1, 5);
export const BURST_ACTIVE_UPLOADS_GLOBAL = Math.max(
    SAFE_ACTIVE_UPLOADS_GLOBAL,
    parseEnvIntInRange(process.env.UPLOAD_BURST_ACTIVE_GLOBAL, 5, 1, 6)
);
export const MAX_ACTIVE_UPLOADS_PER_USER = BURST_ACTIVE_UPLOADS_PER_USER;
export const MAX_GLOBAL_ACTIVE_UPLOADS = BURST_ACTIVE_UPLOADS_GLOBAL;

const MIN_SUPPORTED_UPLOAD_SIZE_BYTES = 400 * 1024 * 1024;
const ENV_MAX_FILE_SIZE_BYTES = Number.parseInt(String(process.env.UPLOAD_MAX_FILE_SIZE_BYTES || ''), 10);
export const MAX_FILE_SIZE_BYTES = Number.isFinite(ENV_MAX_FILE_SIZE_BYTES) && ENV_MAX_FILE_SIZE_BYTES > 0
    ? Math.max(ENV_MAX_FILE_SIZE_BYTES, MIN_SUPPORTED_UPLOAD_SIZE_BYTES)
    : 1024 * 1024 * 1024;

const ENV_TMP_USAGE_SOFT_LIMIT_BYTES = Number.parseInt(String(process.env.UPLOAD_TMP_USAGE_SOFT_LIMIT_BYTES || ''), 10);
export const TMP_USAGE_SOFT_LIMIT_BYTES = Number.isFinite(ENV_TMP_USAGE_SOFT_LIMIT_BYTES) && ENV_TMP_USAGE_SOFT_LIMIT_BYTES > 0
    ? ENV_TMP_USAGE_SOFT_LIMIT_BYTES
    : 900 * 1024 * 1024;

export const QUEUE_PROMOTION_LOCK_KEY = 910205;
export const QUEUE_POLL_MS_MIN = 2500;
export const QUEUE_POLL_MS_MAX = 7000;
export const PROCESSING_POLL_MS_MIN = 2000;
export const PROCESSING_POLL_MS_MAX = 5500;
export const CHUNK_DELAY_MS_MIN = 0;
export const CHUNK_DELAY_MS_MAX = 120;
export const MAX_ACTIVE_SESSION_FETCH = 250;
export const FINALIZER_PROGRESS_UPDATE_THROTTLE_MS = 800;

export const TELEGRAM_FINALIZER_CONCURRENCY = parseEnvIntInRange(process.env.UPLOAD_TELEGRAM_FINALIZER_CONCURRENCY, 2, 1, 3);
export const THUMBNAIL_CONCURRENCY = parseEnvIntInRange(process.env.UPLOAD_THUMBNAIL_CONCURRENCY, 2, 1, 4);
export const FINALIZER_RETRY_BASE_MS = parseEnvIntInRange(process.env.UPLOAD_FINALIZER_RETRY_BASE_MS, 2000, 500, 60_000);
export const FINALIZER_RETRY_MAX_MS = parseEnvIntInRange(process.env.UPLOAD_FINALIZER_RETRY_MAX_MS, 60_000, 1000, 10 * 60_000);
export const FINALIZER_MAX_RETRIES = parseEnvIntInRange(process.env.UPLOAD_FINALIZER_MAX_RETRIES, 5, 0, 12);
export const LARGE_FILE_PARTIAL_HASH_THRESHOLD_BYTES = parseEnvIntInRange(process.env.UPLOAD_PARTIAL_HASH_THRESHOLD_BYTES, 64 * 1024 * 1024, 8 * 1024 * 1024, 5 * 1024 * 1024 * 1024);
export const PARTIAL_HASH_SAMPLE_BYTES = parseEnvIntInRange(process.env.UPLOAD_PARTIAL_HASH_SAMPLE_BYTES, 2 * 1024 * 1024, 128 * 1024, 8 * 1024 * 1024);
export const MAX_PARALLEL_CHUNK_UPLOADS = parseEnvIntInRange(process.env.UPLOAD_MAX_PARALLEL_CHUNKS, 4, 1, 16);

export const UPLOAD_MAINTENANCE_INTERVAL_MS = Number.parseInt(String(process.env.UPLOAD_MAINTENANCE_INTERVAL_MS || String(15 * 60 * 1000)), 10) || (15 * 60 * 1000);
export const TERMINAL_TEMP_RETENTION_MS = Number.parseInt(String(process.env.UPLOAD_TERMINAL_TEMP_RETENTION_MS || String(6 * 60 * 60 * 1000)), 10) || (6 * 60 * 60 * 1000);
export const ORPHAN_TEMP_RETENTION_MS = Number.parseInt(String(process.env.UPLOAD_ORPHAN_TEMP_RETENTION_MS || String(6 * 60 * 60 * 1000)), 10) || (6 * 60 * 60 * 1000);

// ─── Module-level mutable state (shared singletons) ─────────────────────────

export const activeFinalizers = new Map<string, Promise<void>>();
export const pendingFinalizerRetries = new Map<string, ReturnType<typeof setTimeout>>();
export const finalizerAttemptByUploadId = new Map<string, number>();
export const activeChunksByUploadId = new Map<string, number>();
export const chunkIndexLocks = new Set<string>();

export const telegramSemaphore = new Semaphore(TELEGRAM_FINALIZER_CONCURRENCY);
export const thumbnailSemaphore = new Semaphore(THUMBNAIL_CONCURRENCY);

let _uploadMaintenanceTimer: ReturnType<typeof setInterval> | null = null;
export const getMaintenanceTimer = () => _uploadMaintenanceTimer;
export const setMaintenanceTimer = (timer: ReturnType<typeof setInterval> | null) => {
    _uploadMaintenanceTimer = timer;
};

let _tmpUsageCacheBytes = 0;
let _tmpUsageCacheAt = 0;
export const getTmpUsageCache = () => ({ bytes: _tmpUsageCacheBytes, at: _tmpUsageCacheAt });
export const setTmpUsageCache = (bytes: number, at: number) => {
    _tmpUsageCacheBytes = bytes;
    _tmpUsageCacheAt = at;
};
