import pool from '../../config/db';
import fs from 'fs';
import path from 'path';
import { formatFileRow } from '../../utils/formatters';
import { toInt, parseUploadedChunks, computeNextExpectedChunk, computeMissingChunks } from './upload.helpers';
import { getCapacitySnapshot, buildBackpressureHints } from './upload.capacity';
import { getQueuePosition } from './upload.queue';
import { signUploadResumeToken } from './upload.resume';
import {
    UploadSessionRow,
    UploadChunkStats,
    UploadManifestIntegrity,
    UploadLifecycleStatus,
    CapacitySnapshot,
    FIXED_CHUNK_SIZE_BYTES,
    UPLOAD_TMP_ROOT,
} from './upload.types';

// ─── Session CRUD ───────────────────────────────────────────────────────────

export const getUploadSessionById = async (uploadId: string): Promise<UploadSessionRow | null> => {
    const result = await pool.query('SELECT * FROM upload_sessions WHERE upload_id = $1 LIMIT 1', [uploadId]);
    return (result.rows[0] as UploadSessionRow) || null;
};

export const getOwnedUploadSession = async (uploadId: string, userId: string): Promise<UploadSessionRow | null> => {
    const result = await pool.query(
        'SELECT * FROM upload_sessions WHERE upload_id = $1 AND user_id = $2 LIMIT 1',
        [uploadId, userId]
    );
    return (result.rows[0] as UploadSessionRow) || null;
};

// ─── Chunk stats ────────────────────────────────────────────────────────────

export const getChunkStats = async (uploadId: string): Promise<UploadChunkStats> => {
    const result = await pool.query(
        `SELECT
            COUNT(*)::int AS uploaded_count,
            COALESCE(SUM(chunk_size_bytes), 0)::bigint AS uploaded_bytes,
            COALESCE(jsonb_agg(chunk_index ORDER BY chunk_index), '[]'::jsonb) AS uploaded_chunks
         FROM upload_session_chunks
         WHERE upload_id = $1`,
        [uploadId]
    );
    const row = result.rows[0] || {};
    return {
        uploadedCount: toInt(row.uploaded_count),
        uploadedBytes: toInt(row.uploaded_bytes),
        uploadedChunks: parseUploadedChunks(row.uploaded_chunks),
    };
};

/** Remove acknowledgements whose bytes disappeared after a storage restart.
 * The client must resend these chunks; a Neon row alone is not proof of data. */
export const reconcileStoredChunks = async (session: UploadSessionRow): Promise<number> => {
    if (!['uploading', 'queued', 'paused'].includes(session.status)) return 0;
    const currentRootPath = path.join(UPLOAD_TMP_ROOT, session.upload_id);
    if (session.temp_file_path !== currentRootPath) {
        try {
            await fs.promises.access(session.temp_file_path);
        } catch {
            // A former ephemeral path cannot be recovered. Rebase the session
            // onto the configured staging volume, then request its missing bytes.
            await fs.promises.mkdir(currentRootPath, { recursive: true });
            await pool.query(
                'UPDATE upload_sessions SET temp_file_path = $2 WHERE upload_id = $1 AND temp_file_path = $3',
                [session.upload_id, currentRootPath, session.temp_file_path]
            );
            session.temp_file_path = currentRootPath;
        }
    }
    const rows = await pool.query(
        'SELECT chunk_index, chunk_size_bytes FROM upload_session_chunks WHERE upload_id = $1',
        [session.upload_id]
    );
    const missing: number[] = [];
    for (const row of rows.rows) {
        const chunkIndex = toInt(row.chunk_index);
        try {
            const stat = await fs.promises.stat(path.join(session.temp_file_path, `chunk_${chunkIndex}.tmp`));
            if (!stat.isFile() || stat.size !== toInt(row.chunk_size_bytes)) missing.push(chunkIndex);
        } catch {
            missing.push(chunkIndex);
        }
    }
    if (!missing.length) return 0;
    await pool.query(
        'DELETE FROM upload_session_chunks WHERE upload_id = $1 AND chunk_index = ANY($2::int[])',
        [session.upload_id, missing]
    );
    const stats = await saveChunkMetricsToSession(session.upload_id, session.status);
    session.uploaded_chunks = stats.uploadedChunks;
    session.received_bytes = stats.uploadedBytes;
    return missing.length;
};

export const validateChunkManifestIntegrity = async (
    uploadId: string,
    totalChunks: number,
    chunkSize: number,
    totalBytes: number
): Promise<UploadManifestIntegrity> => {
    const safeTotalChunks = Math.max(0, totalChunks);
    const safeChunkSize = Math.max(1, chunkSize);
    const safeTotalBytes = Math.max(0, totalBytes);

    const rowsRes = await pool.query(
        `SELECT chunk_index, chunk_size_bytes
         FROM upload_session_chunks
         WHERE upload_id = $1
         ORDER BY chunk_index ASC`,
        [uploadId]
    );

    const seen = new Set<number>();
    const invalidChunkSizes: Array<{ chunkIndex: number; expected: number; actual: number }> = [];
    let uploadedBytes = 0;

    for (const row of rowsRes.rows) {
        const chunkIndex = toInt(row.chunk_index);
        const actual = Math.max(0, toInt(row.chunk_size_bytes));

        if (chunkIndex < 0 || chunkIndex >= safeTotalChunks || seen.has(chunkIndex)) {
            invalidChunkSizes.push({ chunkIndex, expected: -1, actual });
            continue;
        }

        const expected = chunkIndex === safeTotalChunks - 1
            ? Math.max(safeTotalBytes - (chunkIndex * safeChunkSize), 0)
            : safeChunkSize;

        if (actual !== expected) {
            invalidChunkSizes.push({ chunkIndex, expected, actual });
        }

        uploadedBytes += actual;
        seen.add(chunkIndex);
    }

    const missingChunks: number[] = [];
    for (let idx = 0; idx < safeTotalChunks; idx += 1) {
        if (!seen.has(idx)) missingChunks.push(idx);
    }

    const valid = missingChunks.length === 0
        && invalidChunkSizes.length === 0
        && seen.size === safeTotalChunks
        && uploadedBytes === safeTotalBytes;

    return {
        valid,
        missingChunks: missingChunks.slice(0, 16),
        invalidChunkSizes: invalidChunkSizes.slice(0, 16),
        uploadedCount: seen.size,
        expectedCount: safeTotalChunks,
        uploadedBytes,
        expectedBytes: safeTotalBytes,
    };
};

// ─── Session updates ────────────────────────────────────────────────────────

export const saveChunkMetricsToSession = async (uploadId: string, status: UploadLifecycleStatus = 'uploading') => {
    const stats = await getChunkStats(uploadId);
    await pool.query(
        `UPDATE upload_sessions
         SET uploaded_chunks = $2::jsonb,
             received_bytes = $3,
             status = CASE WHEN status IN ('uploading', 'queued') THEN $4 ELSE status END,
             updated_at = NOW()
         WHERE upload_id = $1 AND status NOT IN ('completed', 'cancelled')`,
        [uploadId, JSON.stringify(stats.uploadedChunks), stats.uploadedBytes, status]
    );
    return stats;
};

export const updateSessionFailure = async (uploadId: string, code: string, message: string, retryable: boolean) => {
    await pool.query(
        `UPDATE upload_sessions
         SET status = 'failed',
             error_code = $2,
             error_message = $3,
             retryable = $4,
             updated_at = NOW()
         WHERE upload_id = $1`,
        [uploadId, code, message, retryable]
    );
};

// ─── Status projection ─────────────────────────────────────────────────────

export const calculateSessionProgress = (session: UploadSessionRow): number => {
    const totalBytes = Math.max(0, toInt(session.total_bytes));
    const receivedBytes = Math.max(0, toInt(session.received_bytes));
    const telegramProgress = Math.min(Math.max(toInt(session.telegram_progress_percent), 0), 100);

    if (session.status === 'completed') return 100;
    if (session.status === 'cancelled' || session.status === 'failed' || session.status === 'paused') {
        if (totalBytes === 0) return 0;
        return Math.min(Math.round((receivedBytes / totalBytes) * 50), 99);
    }

    const chunkPhase = totalBytes > 0
        ? Math.round(Math.min((receivedBytes / totalBytes) * 50, 50))
        : 0;

    if (receivedBytes >= totalBytes) {
        return Math.min(99, Math.max(50, Math.round(50 + (telegramProgress * 0.5))));
    }
    return chunkPhase;
};

export const toClientUploadStatus = (session: UploadSessionRow): string => {
    if (session.status === 'failed') return 'error';
    if (session.status === 'paused') return 'paused';
    if (session.status === 'processing') {
        return 'processing';
    }
    if (session.status === 'uploading' && toInt(session.received_bytes) >= toInt(session.total_bytes)) {
        return 'processing';
    }
    return session.status;
};

export const toUploadStatusPayload = async (session: UploadSessionRow, capacityOverride?: CapacitySnapshot) => {
    await reconcileStoredChunks(session);
    const uploadedChunks = parseUploadedChunks(session.uploaded_chunks);
    const totalChunks = toInt(session.total_chunks);
    const nextExpectedChunk = computeNextExpectedChunk(totalChunks, uploadedChunks);
    const missingChunks = computeMissingChunks(totalChunks, uploadedChunks);

    let filePayload: any = null;
    if (session.file_id) {
        const fileRes = await pool.query('SELECT * FROM files WHERE id = $1 LIMIT 1', [session.file_id]);
        if (fileRes.rows.length > 0) {
            filePayload = formatFileRow(fileRes.rows[0]);
        }
    }

    const capacity = capacityOverride || await getCapacitySnapshot(session.user_id);
    const hints = buildBackpressureHints(session.status, capacity);
    const queuePosition = session.status === 'queued'
        ? await getQueuePosition(session.upload_id, session.user_id)
        : { queuePositionGlobal: 0, queuePositionUser: 0 };

    return {
        success: true,
        progress: calculateSessionProgress(session),
        status: toClientUploadStatus(session),
        resumeToken: signUploadResumeToken(session.user_id, session.upload_id),
        file: filePayload,
        error: session.error_message,
        errorCode: session.error_code,
        code: session.error_code,
        retryable: Boolean(session.retryable),
        receivedBytes: toInt(session.received_bytes),
        totalBytes: toInt(session.total_bytes),
        uploadedChunks,
        uploadedChunksCount: uploadedChunks.length,
        missingChunks: missingChunks.slice(0, 256),
        missingChunksCount: missingChunks.length,
        totalChunks,
        chunkSizeBytes: toInt(session.chunk_size_bytes),
        nextExpectedChunk,
        uploadId: session.upload_id,
        uploadMode: 'chunk',
        updatedAt: session.updated_at,
        queuePositionGlobal: queuePosition.queuePositionGlobal,
        queuePositionUser: queuePosition.queuePositionUser,
        ...hints,
    };
};
