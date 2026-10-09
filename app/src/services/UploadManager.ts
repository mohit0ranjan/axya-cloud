/** Durable, account-scoped upload queue with acknowledged chunk recovery. */

import { File, Paths, Directory } from "expo-file-system";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Notifications from "expo-notifications";
import * as Network from "expo-network";
import { Platform, AppState, AppStateStatus } from "react-native";
import { getNotificationsEnabled } from "../utils/preferences";
import { Buffer } from "buffer";
import apiClient, { uploadClient } from "./apiClient";
import { syncAfterFileMutation } from "./fileStateSync";
import { normalizeUploadFile, sanitizeFileName } from "../utils/fileSafety";
import { serverReadiness } from "./serverReadiness";
import { retainUploadSource, discardUploadSource } from "./uploadSourceStore";
import { nativeTransfer } from './nativeTransfer';
import { getSecureValue, SECURE_KEYS } from '../utils/secureStorage';
import { API_URL } from '../config/urls';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface FileAsset {
  uri: string;
  name: string;
  size: number;
  mimeType?: string;
}

export type UploadStatus =
  | "pending"
  | "preparing"
  | "queued"
  | "uploading"
  | "processing"
  | "paused"
  | "waiting_retry"
  | "retrying"
  | "completed"
  | "failed"
  | "cancelled";

export interface UploadTask {
  id: string;
  file: FileAsset;
  folderId: string | null;
  chatTarget: string;
  /** 0–100 */
  progress: number;
  /** Bytes successfully sent so far */
  bytesUploaded: number;
  /** Smoothed upload speed in bytes/sec */
  currentSpeedBps?: number;
  /** Estimated remaining seconds */
  etaSeconds?: number;
  /** Optional backend queue position among all users */
  queuePositionGlobal?: number;
  /** Optional backend queue position for this user */
  queuePositionUser?: number;
  status: UploadStatus;
  error?: string;
  retryCount: number;
  /** Server-assigned upload session ID */
  uploadId?: string;
  /** Fingerprint for deduplication (uri + name + size) */
  fingerprint: string;
  /** True if server detected this file already exists (hash match) */
  duplicate?: boolean;
  /** Restored after app restart/interruption and waiting for explicit user resume */
  recovered?: boolean;
  pausedForBackground?: boolean;
  pausedForConnection?: boolean;
  nativeOwned?: boolean;
  priority?: number;
  chunkSizeBytes?: number;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
}

export const UPLOAD_NOTIFICATION_CATEGORY_ID = "upload_progress_actions";
export const UPLOAD_NOTIFICATION_ACTION_PAUSE = "UPLOAD_ACTION_PAUSE";
export const UPLOAD_NOTIFICATION_ACTION_RESUME = "UPLOAD_ACTION_RESUME";
export const UPLOAD_NOTIFICATION_ACTION_CANCEL = "UPLOAD_ACTION_CANCEL";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Generate a fingerprint for deduplication */
function makeFingerprint(file: FileAsset): string {
  const normalized = normalizeUploadFile(file);
  return `${normalized.uri}|${normalized.name}|${file.size}`;
}

function toFiniteNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clampProgress(value: unknown): number {
  return Math.max(0, Math.min(Math.round(toFiniteNumber(value, 0)), 100));
}

/**
 * Write a chunk from `uri` at [offset, offset+length) to a temp file and return
 * its path. The temp file is suitable for FormData upload and should be deleted
 * after the upload completes.
 */
async function writeChunkToTempFile(
  uri: string,
  offset: number,
  length: number,
  chunkIndex: number,
): Promise<string> {
  const tmpDirName = "upload_chunks";
  const tmpDirObj = new Directory(Paths.cache, tmpDirName);
  if (!tmpDirObj.exists) {
    // createDirectory internally handles it or we can use create
    tmpDirObj.create({ intermediates: true, idempotent: true });
  }
  const tmpFileName = `chunk_${chunkIndex}_${Date.now()}.bin`;
  const tmpFileObj = new File(tmpDirObj, tmpFileName);

  // new API allows setting overwrite: true to overwrite any existing file
  tmpFileObj.create({ overwrite: true });
  const tmpPath = tmpFileObj.uri;

  try {
    const fileObj = new File(uri);
    const handle = fileObj.open();
    try {
      handle.offset = offset;
      const chunkBytes = handle.readBytes(length);
      // Write raw bytes directly to temp file
      tmpFileObj.write(chunkBytes);
      return tmpPath;
    } finally {
      handle.close();
    }
  } catch {
    // Fallback for URIs that FileHandle can't access
    // We still need to use legacy readAsStringAsync since File doesn't support reading by offset via promises
    // wait, we can just use File.readBytes if it opens, but if it throws we'll fallback
    // The legacy API still works for content:// URIs on Android
    const legacyFileSystem = require("expo-file-system/legacy");
    const base64 = await legacyFileSystem.readAsStringAsync(uri, {
      encoding: "base64",
      position: offset,
      length: length,
    });

    // Write the base64 content
    await legacyFileSystem.writeAsStringAsync(tmpPath, base64, {
      encoding: "base64",
    });
    return tmpPath;
  }
}

// ─── UploadManager ────────────────────────────────────────────────────────────

class UploadManager {
  public tasks: UploadTask[] = [];
  private ownerId: string | null = null;
  private queueReady = false;
  private sourceRetention = new Map<string, Promise<void>>();
  private accountRevision = 0;
  private accountSwitch: Promise<void> = Promise.resolve();
  private nativeTimer: ReturnType<typeof setInterval> | undefined;
  private nativePolling = false;
  private nativeSeenCompleted = new Set<string>();

  private async pollNative() {
    const owner = this.ownerId; const revision = this.accountRevision;
    if (!nativeTransfer || !owner || this.nativePolling) return;
    this.nativePolling = true;
    try {
      const rows: UploadTask[] = JSON.parse(await nativeTransfer.snapshot(owner));
      if (owner !== this.ownerId || revision !== this.accountRevision) return;
      for (const row of rows) {
        const current = this.tasks.find(t => t.id === row.id);
        if (current) Object.assign(current, row, { nativeOwned: true });
        else this.tasks.push({ ...row, nativeOwned: true });
        if (row.status === 'completed' && !this.nativeSeenCompleted.has(row.id)) {
          this.nativeSeenCompleted.add(row.id); syncAfterFileMutation();
        }
      }
      this.notifyListeners();
    } catch (e) { console.warn('[UploadManager] Native queue could not be read'); }
    finally { this.nativePolling = false; }
  }

  public prioritize(id: string) {
    const task = this.tasks.find(t => t.id === id);
    if (!task || ['completed', 'cancelled'].includes(task.status)) return;
    task.priority = 1;
    this.tasks.sort((a, b) => (b.priority || 0) - (a.priority || 0) || a.createdAt - b.createdAt);
    if (task.nativeOwned && this.ownerId) void nativeTransfer?.action(this.ownerId, id, 'priority').catch(() => {});
    this.notifyListeners(true); this.scheduleQueuePump();
  }

  public async setTransferConstraints(wifiOnly: boolean, chargingOnly: boolean) {
    if (!this.ownerId) return;
    await AsyncStorage.setItem(`@transfer_constraints:${this.ownerId}`, JSON.stringify({ wifiOnly, chargingOnly }));
    if (nativeTransfer) {
      const token = await getSecureValue(SECURE_KEYS.JWT_TOKEN);
      if (token) await nativeTransfer.configure(this.ownerId, token, API_URL, wifiOnly, chargingOnly);
    }
  }

  public bindOwner(ownerId: string | null): Promise<void> {
    if (this.queueReady && this.ownerId === ownerId) return this.accountSwitch;
    this.queueReady = false;
    const revision = ++this.accountRevision;
    for (const controller of this.abortControllers.values()) controller.abort();
    this.accountSwitch = this.accountSwitch.then(async () => {
      if (this.ownerId !== ownerId) {
        if (this.nativeTimer) clearInterval(this.nativeTimer);
        if (nativeTransfer && this.ownerId) await nativeTransfer.detach(this.ownerId);
        this.pauseAllBackground();
        await this.saveQueue();
        for (const controller of this.abortControllers.values())
          controller.abort();
        this.abortControllers.clear();
        this.inFlightTaskIds.clear();
        if (this.pendingSaveTimer) clearTimeout(this.pendingSaveTimer);
        this.pendingSaveTimer = null;
        this.tasks = [];
        this.cachedStats = null;
        this.clearedCompletedCount = 0;
        this.clearedFailedCount = 0;
        this.clearedTotalBytes = 0;
        this.clearedUploadedBytes = 0;
        this.clearedTotalFiles = 0;
        this.ownerId = ownerId;
        if (ownerId) await this.loadQueue();
        if (nativeTransfer && ownerId) {
          const token = await getSecureValue(SECURE_KEYS.JWT_TOKEN);
          const constraints = JSON.parse(await AsyncStorage.getItem(`@transfer_constraints:${ownerId}`) || '{}');
          if (token) await nativeTransfer.configure(ownerId, token, API_URL, !!constraints.wifiOnly, !!constraints.chargingOnly);
          await this.pollNative();
          for (const task of this.tasks.filter(t => !t.nativeOwned && !['completed', 'cancelled', 'failed'].includes(t.status))) {
            try {
              const saved = await retainUploadSource(ownerId, task.id, task.file.uri);
              task.file = { ...task.file, uri: saved.uri, size: saved.size }; task.nativeOwned = true;
              await nativeTransfer.enqueue(ownerId, JSON.stringify([task]));
            } catch { task.status = 'failed'; task.error = 'Select this file again to restore its upload source.'; }
          }
          this.nativeTimer = setInterval(() => { void this.pollNative(); }, 1500);
        }
      }
      if (revision === this.accountRevision) {
        this.queueReady = Boolean(ownerId);
        this.notifyListeners(true);
        if (ownerId) this.scheduleQueuePump();
      }
    });
    return this.accountSwitch;
  }
  // Adaptive mobile concurrency to keep UX smooth for large batches.
  private readonly MIN_CONCURRENT = 3;
  private readonly MAX_CONCURRENT = 5;
  private readonly INITIAL_ACTIVE_WINDOW = 20;
  private readonly MAX_RETRIES = 12;
  private readonly CHUNK_SIZE = 5 * 1024 * 1024; // 5 MB chunks
  // ✅ Throttle notify to ~200ms to avoid excessive React re-renders
  private readonly NOTIFY_THROTTLE_MS = 200;
  private readonly SPEED_WINDOW_MS = 3000;
  private readonly MAX_PERSISTED_TASKS = 220;
  private readonly MAX_TERMINAL_HISTORY = 120;
  private readonly notificationsEnabled =
    Platform.OS !== "web" &&
    typeof Notifications.scheduleNotificationAsync === "function";

  // ── Historical stats for auto-cleared tasks ──
  private clearedCompletedCount = 0;
  private clearedFailedCount = 0;
  private clearedTotalBytes = 0;
  private clearedUploadedBytes = 0;
  private clearedTotalFiles = 0;

  // ── Cached stats (invalidated on every notify) ──
  private cachedStats: ReturnType<UploadManager["computeStats"]> | null = null;
  private speedSamples: Array<{ ts: number; uploadedBytes: number }> = [];
  private emaUploadSpeedBps = 0;
  private lastSpeedSampleTs = 0;

  private get activeUploads(): number {
    return this.tasks.filter(
      (t) => t.status === "uploading" || t.status === "processing",
    ).length;
  }

  private readonly inFlightTaskIds = new Set<string>();
  private readonly perTaskSpeedState = new Map<
    string,
    { lastBytes: number; lastTs: number; emaBps: number }
  >();
  private taskIdCounter = 0;

  private getAdaptiveConcurrency(): number {
    const nonTerminalCount = this.tasks.filter(
      (task) => !["completed", "failed", "cancelled"].includes(task.status),
    ).length;
    if (nonTerminalCount >= 120) return this.MAX_CONCURRENT;
    if (nonTerminalCount >= 40) return 4;
    return this.MIN_CONCURRENT;
  }

  private getRunnableWindowTaskIds(): Set<string> {
    const ordered = [...this.tasks].sort((a, b) => {
      if ((a.priority || 0) !== (b.priority || 0)) return (b.priority || 0) - (a.priority || 0);
      if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
      return a.id.localeCompare(b.id);
    });

    const runnable = ordered.filter(
      (task) => !["completed", "failed", "cancelled"].includes(task.status),
    );
    const windowed = runnable.slice(0, this.INITIAL_ACTIVE_WINDOW);
    return new Set(windowed.map((task) => task.id));
  }

  /** Debounced queue pump — prevents thundering herd of concurrent processQueue calls */
  private queuePumpTimer: ReturnType<typeof setTimeout> | null = null;

  private scheduleQueuePump() {
    if (this.queuePumpTimer) return;
    this.queuePumpTimer = setTimeout(() => {
      this.queuePumpTimer = null;
      const target = this.getAdaptiveConcurrency();
      const missingSlots = Math.max(0, target - this.inFlightTaskIds.size);
      for (let i = 0; i < missingSlots; i += 1) {
        void this.processQueue();
      }
    }, 50);
  }

  private static VALID_TRANSITIONS: Record<UploadStatus, UploadStatus[]> = {
    preparing: ["queued", "uploading", "paused", "cancelled"],
    queued: ["uploading", "paused", "cancelled"],
    uploading: [
      "processing",
      "completed",
      "waiting_retry",
      "failed",
      "paused",
      "cancelled",
      "queued",
    ],
    processing: ["completed", "waiting_retry", "failed", "paused", "cancelled"],
    waiting_retry: ["retrying", "cancelled", "paused"],
    retrying: ["uploading", "cancelled", "paused"],
    paused: ["queued"],
    failed: ["queued"],
    completed: [],
    cancelled: [],
    pending: ["preparing", "queued"],
  };

  private transition(task: UploadTask, to: UploadStatus): boolean {
    const allowed = UploadManager.VALID_TRANSITIONS[task.status];
    if (!allowed?.includes(to)) {
      console.warn(
        `[SM] Illegal: ${task.status} → ${to} for "${task.file.name}"`,
      );
      return false;
    }
    task.status = to;
    return true;
  }

  private makeTaskId(): string {
    this.taskIdCounter = (this.taskIdCounter + 1) % 1_000_000;
    return `${Date.now()}_${this.taskIdCounter}_${Math.random().toString(36).slice(2, 10)}`;
  }

  private resolveProgressFraction(
    progressEvent: any,
    fallbackTotal: number,
  ): number {
    const fallback = Math.max(1, toFiniteNumber(fallbackTotal, 1));
    const loaded = Math.max(
      0,
      toFiniteNumber(progressEvent?.loaded ?? progressEvent?.bytes, 0),
    );
    let totalCandidate = toFiniteNumber(progressEvent?.total, fallback);
    const total =
      Number.isFinite(totalCandidate) && totalCandidate > 0
        ? totalCandidate
        : Math.max(loaded, fallback, 1);
    return Math.max(0, Math.min(loaded / total, 1));
  }

  private updateTask(id: string, updates: Partial<UploadTask>) {
    const index = this.tasks.findIndex((t) => t.id === id);
    if (index === -1) return;
    // Workers retain this object while awaiting network calls. Keep internal
    // identity stable; subscribers receive immutable copies in snapshotTasks.
    Object.assign(this.tasks[index], updates, { updatedAt: Date.now() });
    this.cachedStats = null; // Invalidate stats cache
    this.notifyListeners();
  }

  private resetTaskTelemetry(taskId: string) {
    this.perTaskSpeedState.delete(taskId);
  }

  private updateTaskProgressWithTelemetry(
    task: UploadTask,
    bytesUploaded: number,
    progress: number,
  ) {
    const fileSize = Math.max(0, toFiniteNumber(task.file.size, 0));
    const safeBytes = Math.max(
      0,
      Math.min(Math.round(toFiniteNumber(bytesUploaded, 0)), fileSize),
    );
    const safeProgress = clampProgress(progress);
    const now = Date.now();
    const previous = this.perTaskSpeedState.get(task.id);

    let emaBps = previous?.emaBps || 0;
    if (previous) {
      const deltaBytes = Math.max(0, safeBytes - previous.lastBytes);
      const deltaSeconds = Math.max((now - previous.lastTs) / 1000, 0.001);
      const instantBps = deltaBytes / deltaSeconds;
      if (instantBps > 0) {
        const alpha = 0.35;
        emaBps =
          emaBps === 0 ? instantBps : alpha * instantBps + (1 - alpha) * emaBps;
      }
    }

    this.perTaskSpeedState.set(task.id, {
      lastBytes: safeBytes,
      lastTs: now,
      emaBps,
    });

    const remainingBytes = Math.max(0, fileSize - safeBytes);
    const etaSeconds =
      emaBps > 1 ? Math.ceil(remainingBytes / emaBps) : undefined;

    this.updateTask(task.id, {
      bytesUploaded: safeBytes,
      progress: safeProgress,
      currentSpeedBps: Math.round(Math.max(emaBps, 0)),
      etaSeconds,
    });
  }

  private clampRecommendedMs(
    value: unknown,
    min: number,
    max: number,
    fallback: number,
  ): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(min, Math.min(max, Math.round(parsed)));
  }

  private async delayWithAbort(ms: number, signal: AbortSignal) {
    const clamped = Math.max(0, Math.round(ms));
    if (clamped <= 0) return;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        signal.removeEventListener("abort", onAbort);
        resolve();
      }, clamped);

      const onAbort = () => {
        clearTimeout(timer);
        reject(new Error("Cancelled"));
      };

      signal.addEventListener("abort", onAbort, { once: true });
    });
  }

  private listeners: ((tasks: UploadTask[]) => void)[] = [];

  /**
   * Map of taskId → AbortController.
   * Aborting signals the running performUpload to stop.
   */
  private abortControllers: Map<string, AbortController> = new Map();

  /** Throttle: timestamp of last notify */
  private lastNotifyTime = 0;
  private pendingNotifyTimer: ReturnType<typeof setTimeout> | null = null;

  /** Throttled persistence to avoid excessive AsyncStorage writes */
  private lastSaveTime = 0;
  private pendingSaveTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly SAVE_THROTTLE_MS = 3000;

  private appStateSubscription: any = null;
  private networkOffline = false;

  private handleConnectivity(state: Network.NetworkState) {
    const offline = state.isConnected === false || state.isInternetReachable === false;
    this.networkOffline = offline;
    if (nativeTransfer) return; // Native network constraints own automatic recovery.
    if (offline) {
      for (const task of this.tasks) {
        if (task.status !== 'paused' && this.pause(task.id)) {
          task.pausedForConnection = true;
          task.error = 'Waiting for internet. Upload resumes automatically.';
        }
      }
      this.notifyListeners(true);
    } else {
      for (const task of this.tasks) {
        if (task.status === 'paused' && task.pausedForConnection) this.resume(task.id);
      }
      this.scheduleQueuePump();
    }
  }

  constructor() {
    if (typeof Network.addNetworkStateListener === 'function') {
      let receivedEvent = false;
      Network.addNetworkStateListener(state => { receivedEvent = true; this.handleConnectivity(state); });
      void Network.getNetworkStateAsync().then(state => {
        if (!receivedEvent) this.handleConnectivity(state);
      }).catch(() => {});
    }
    serverReadiness.subscribe((state) => {
      if (state.phase !== "ready") return;
      if (
        !this.tasks.some(
          (task) =>
            task.status === "preparing" ||
            task.status === "queued" ||
            task.status === "retrying",
        )
      )
        return;
      void this.processQueue();
    });

    // Background AppState handling
    if (Platform.OS !== "web") {
      this.appStateSubscription = AppState.addEventListener(
        "change",
        (nextAppState: AppStateStatus) => {
          const isBackground =
            nextAppState === "background" || nextAppState === "inactive";
          if (isBackground) {
            if (!nativeTransfer) this.pauseAllBackground();
          } else if (nextAppState === "active") {
            this.resumeAllBackground();
          }
        },
      );
    }
  }

  // ── Persistence ───────────────────────────────────────────────────────────

  private async loadQueue() {
    try {
      const stored = await AsyncStorage.getItem(
        `@upload_queue_v3:${this.ownerId}`,
      );
      if (stored) {
        const parsed: UploadTask[] = JSON.parse(stored);
        this.tasks = parsed.map((task) => {
          const now = Date.now();
          const safeName = sanitizeFileName(
            String(task?.file?.name || "file"),
            "file",
          );
          const fileSize = Math.max(0, toFiniteNumber(task?.file?.size, 0));
          const baseTask: UploadTask = {
            ...task,
            file: {
              uri: String(task?.file?.uri || ""),
              name: safeName,
              size: fileSize,
              mimeType: task?.file?.mimeType,
            },
            progress: clampProgress(task?.progress),
            bytesUploaded: Math.max(
              0,
              Math.min(
                Math.round(toFiniteNumber(task?.bytesUploaded, 0)),
                fileSize,
              ),
            ),
            retryCount: Math.max(
              0,
              Math.round(toFiniteNumber(task?.retryCount, 0)),
            ),
            createdAt: Number(task?.createdAt || now),
            updatedAt: Number(task?.updatedAt || now),
            fingerprint: String(
              task?.fingerprint ||
                makeFingerprint({
                  uri: String(task?.file?.uri || ""),
                  name: safeName,
                  size: fileSize,
                  mimeType: task?.file?.mimeType,
                }),
            ),
          };

          if (baseTask.pausedForConnection || ["uploading", "processing", "retrying", "waiting_retry", "preparing", "pending"].includes(baseTask.status)) {
            return {
              ...baseTask,
              status: "queued" as UploadStatus,
              recovered: true,
              error: undefined,
            };
          }

          return baseTask;
        });
      }
      // Load historical stats
      const statsStored = await AsyncStorage.getItem(
        `@upload_stats_v3:${this.ownerId}`,
      );
      if (statsStored) {
        const parsedStats = JSON.parse(statsStored);
        this.clearedCompletedCount = parsedStats.clearedCompletedCount || 0;
        this.clearedFailedCount = parsedStats.clearedFailedCount || 0;
        this.clearedTotalBytes = parsedStats.clearedTotalBytes || 0;
        this.clearedUploadedBytes = parsedStats.clearedUploadedBytes || 0;
        this.clearedTotalFiles = parsedStats.clearedTotalFiles || 0;
      }

      await this.reconcileQueueWithServer();

      if (stored || statsStored) {
        this.notifyListeners(true); // force, bypass throttle for initial load
      }
      // User-paused tasks stay paused. Only an automatic background pause
      // resumes on a cold launch; interrupted active tasks were queued above.
      this.resumeAllBackground();
      if (
        this.tasks.some(
          (t) =>
            t.status === "preparing" ||
            t.status === "queued" ||
            t.status === "retrying",
        )
      ) {
        // Resume queue automatically after app restart/background wake.
        this.processQueue();
      }
    } catch (e) {
      console.error("[UploadManager] Failed to load queue:", e);
    }
  }

  private async reconcileQueueWithServer() {
    const candidates = this.tasks.filter(
      (task) =>
        Boolean(task.uploadId) &&
        !["completed", "cancelled"].includes(task.status),
    );
    if (candidates.length === 0) return;

    try {
      const response = await apiClient.get("/files/upload/sessions", {
        _maxRetries: 0,
        timeout: 60_000,
      } as any);
      const sessions = Array.isArray(response?.data?.sessions)
        ? response.data.sessions
        : [];
      const byUploadId = new Map<string, any>();
      for (const session of sessions) {
        const uploadId = String(session?.uploadId || "").trim();
        if (uploadId) byUploadId.set(uploadId, session);
      }

      let changed = false;
      this.tasks = this.tasks.map((task) => {
        const uploadId = String(task.uploadId || "").trim();
        if (!uploadId) return task;

        const remote = byUploadId.get(uploadId);
        if (!remote) return task;

        const remoteStatus = String(remote.status || "").toLowerCase();
        const remoteProgress = Math.max(
          0,
          Math.min(Number(remote.progress || 0), 100),
        );
        const remoteBytes = Math.max(0, Number(remote.receivedBytes || 0));
        const remoteError = String(remote.error || "").trim();
        const remoteQueuePositionGlobal = Math.max(
          0,
          Number(remote.queuePositionGlobal || 0),
        );
        const remoteQueuePositionUser = Math.max(
          0,
          Number(remote.queuePositionUser || 0),
        );

        let nextTask = task;
        if (remoteStatus === "completed") {
          nextTask = {
            ...task,
            status: "completed",
            progress: 100,
            bytesUploaded: task.file.size,
            error: undefined,
            completedAt: task.completedAt || Date.now(),
          };
        } else if (remoteStatus === "cancelled") {
          nextTask = {
            ...task,
            status: "cancelled",
            progress: Math.max(task.progress, Math.round(remoteProgress)),
            bytesUploaded: Math.max(
              task.bytesUploaded,
              Math.min(remoteBytes, task.file.size),
            ),
            error: undefined,
            completedAt: task.completedAt || Date.now(),
          };
        } else if (remoteStatus === "error") {
          nextTask = {
            ...task,
            status: "failed",
            progress: Math.max(task.progress, Math.round(remoteProgress)),
            bytesUploaded: Math.max(
              task.bytesUploaded,
              Math.min(remoteBytes, task.file.size),
            ),
            error: remoteError || task.error || "Upload failed",
            completedAt: task.completedAt || Date.now(),
          };
        } else if (remoteStatus === "queued") {
          nextTask = {
            ...task,
            status: task.status === "paused" ? "paused" : "queued",
            progress: Math.max(
              task.progress,
              Math.round(Math.min(remoteProgress, 50)),
            ),
            bytesUploaded: Math.max(
              task.bytesUploaded,
              Math.min(remoteBytes, task.file.size),
            ),
            queuePositionGlobal: remoteQueuePositionGlobal,
            queuePositionUser: remoteQueuePositionUser,
            error: undefined,
          };
        } else if (
          remoteStatus === "processing" ||
          remoteStatus === "uploading_to_telegram"
        ) {
          nextTask = {
            ...task,
            status: task.status === "paused" ? "paused" : "processing",
            progress: Math.max(
              task.progress,
              Math.round(Math.min(remoteProgress, 99)),
            ),
            bytesUploaded: Math.max(
              task.bytesUploaded,
              Math.min(remoteBytes, task.file.size),
            ),
            queuePositionGlobal: 0,
            queuePositionUser: 0,
            error: undefined,
          };
        } else if (remoteStatus === "uploading" || remoteStatus === "pending") {
          nextTask = {
            ...task,
            status: task.status === "paused" ? "paused" : "uploading",
            progress: Math.max(
              task.progress,
              Math.round(Math.min(remoteProgress, 99)),
            ),
            bytesUploaded: Math.max(
              task.bytesUploaded,
              Math.min(remoteBytes, task.file.size),
            ),
            queuePositionGlobal: 0,
            queuePositionUser: 0,
            error: undefined,
          };
        }

        if (nextTask !== task) changed = true;
        return nextTask;
      });

      if (changed) {
        this.cachedStats = null;
      }
    } catch (err) {
      console.warn(
        "[UploadManager] Could not reconcile queue with backend sessions:",
        err,
      );
    }
  }

  private isFatalUploadError(error: any): boolean {
    const message = String(error?.message || "").toLowerCase();
    const status = Number(error?.response?.status || 0);
    const code = String(
      error?.response?.data?.code || error?.code || "",
    ).toUpperCase();
    const retryable = error?.response?.data?.retryable;

    if (code === "UPLOAD_QUEUED" || code === "UPLOAD_PROCESSING") return false;
    if (status === 409 && (retryable === true || code === "CHUNK_RACE"))
      return false;

    if (retryable === false) return true;
    if (code === "TELEGRAM_SESSION_EXPIRED") return true;
    if (
      status === 400 ||
      status === 401 ||
      status === 403 ||
      status === 404 ||
      status === 409 ||
      status === 413 ||
      status === 422
    ) {
      return true;
    }

    return (
      message.includes("session expired") ||
      message.includes("session invalid") ||
      message.includes("re-login") ||
      message.includes("unauthorized") ||
      message.includes("forbidden") ||
      message.includes("quota exceeded") ||
      message.includes("empty file")
    );
  }

  private toUserFacingUploadError(error: any): string {
    const code = String(
      error?.response?.data?.code || error?.code || "",
    ).toLowerCase();
    const backendMessage = String(
      error?.response?.data?.message || error?.response?.data?.error || "",
    ).trim();
    if (code === "schema_not_ready")
      return "Service is starting. Please retry in a moment.";
    if (code === "telegram_session_expired")
      return "Telegram session expired. Please reconnect Telegram in Profile.";
    if (code === "telegram_transient")
      return "Telegram is temporarily unavailable. Retrying may help.";
    if (code === "file_too_large") {
      const maxBytes = Number(error?.response?.data?.details?.maxBytes);
      const limit = Number.isFinite(maxBytes) && maxBytes > 0
        ? ` (${(maxBytes / (1024 * 1024 * 1024)).toFixed(1)} GB)`
        : "";
      return `This file exceeds the current upload limit${limit}.`;
    }
    if (code === "insufficient_upload_storage")
      return "The upload server is temporarily short on space. Retry when storage is available.";
    if (code === "upload_storage_unavailable")
      return "Upload storage is temporarily unavailable. Your file remains queued on this device.";
    if (code === "mime_type_mismatch" || code === "unsupported_mime_type")
      return "This file type is not supported.";
    if (backendMessage) return backendMessage;
    return error?.message || "Upload failed";
  }

  private async saveQueue() {
    const persistedOwner = this.ownerId;
    if (!persistedOwner) return;
    const toSave = this.tasks
      .slice(-this.MAX_PERSISTED_TASKS)
      .map((t) => ({ ...t }));
    await AsyncStorage.setItem(
      `@upload_queue_v3:${persistedOwner}`,
      JSON.stringify(toSave),
    ).catch(() => {});

    const statsToSave = {
      clearedCompletedCount: this.clearedCompletedCount,
      clearedFailedCount: this.clearedFailedCount,
      clearedTotalBytes: this.clearedTotalBytes,
      clearedUploadedBytes: this.clearedUploadedBytes,
      clearedTotalFiles: this.clearedTotalFiles,
    };
    await AsyncStorage.setItem(
      `@upload_stats_v3:${persistedOwner}`,
      JSON.stringify(statsToSave),
    ).catch(() => {});
  }

  /** Throttled save — writes to AsyncStorage at most once per SAVE_THROTTLE_MS */
  private scheduleSave(force = false) {
    if (!this.queueReady) return;
    const now = Date.now();
    if (force || now - this.lastSaveTime >= this.SAVE_THROTTLE_MS) {
      if (this.pendingSaveTimer) {
        clearTimeout(this.pendingSaveTimer);
        this.pendingSaveTimer = null;
      }
      this.lastSaveTime = now;
      this.saveQueue();
    } else if (!this.pendingSaveTimer) {
      this.pendingSaveTimer = setTimeout(
        () => {
          this.pendingSaveTimer = null;
          this.lastSaveTime = Date.now();
          this.saveQueue();
        },
        this.SAVE_THROTTLE_MS - (now - this.lastSaveTime),
      );
    }
  }

  // ── Subscription ─────────────────────────────────────────────────────────

  public subscribe(listener: (tasks: UploadTask[]) => void): () => void {
    this.listeners.push(listener);
    listener(this.snapshotTasks());
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  /**
   * Creates a new array with new task objects on every call.
   * This is critical: React state comparison (===) needs new references
   * to detect changes inside task objects (e.g. progress, status).
   */
  private snapshotTasks(): UploadTask[] {
    return this.tasks.map((task) => ({
      ...task,
      file: { ...task.file },
    }));
  }

  /**
   * Throttled notify — avoids flooding React with state updates during
   * rapid chunk uploads. Forces immediate notify for status changes (force=true).
   */
  private notifyListeners(force = false) {
    this.scheduleSave(force);
    this.cachedStats = null; // Invalidate stats cache on every notify

    const now = Date.now();
    const elapsed = now - this.lastNotifyTime;

    if (force || elapsed >= this.NOTIFY_THROTTLE_MS) {
      // Flush immediately
      if (this.pendingNotifyTimer) {
        clearTimeout(this.pendingNotifyTimer);
        this.pendingNotifyTimer = null;
      }
      this.lastNotifyTime = now;
      this.updateNotification();
      const snapshot = this.snapshotTasks();
      this.listeners.forEach((l) => l(snapshot));
    } else if (!this.pendingNotifyTimer) {
      // Schedule a trailing flush
      this.pendingNotifyTimer = setTimeout(() => {
        this.pendingNotifyTimer = null;
        this.lastNotifyTime = Date.now();
        this.updateNotification();
        const snapshot = this.snapshotTasks();
        this.listeners.forEach((l) => l(snapshot));
      }, this.NOTIFY_THROTTLE_MS - elapsed);
    }
  }

  // ── Aggregate Stats ──────────────────────────────────────────────────────

  public getStats() {
    if (this.cachedStats) return this.cachedStats;
    this.cachedStats = this.computeStats();
    return this.cachedStats;
  }

  /**
   * Compute real aggregate stats from tasks.
   * Called only when cache is invalidated (on task changes).
   */
  private computeStats() {
    // Single pass over tasks array instead of 7 separate filter calls
    let activeUploadedCount = 0;
    let queuedCount = 0;
    let activeFailedCount = 0;
    let activeCount = 0;
    let uploadingCount = 0;
    let pausedCount = 0;
    let cancelledCount = 0;
    let activeTotalBytes = 0;
    let activeUploadedBytes = 0;

    for (const t of this.tasks) {
      const size = Math.max(t.file.size || 1, 1);
      const uploaded = Math.max(
        0,
        Math.min(toFiniteNumber(t.bytesUploaded, 0), size),
      );
      activeTotalBytes += size;

      switch (t.status) {
        case "completed":
          activeUploadedCount++;
          activeUploadedBytes += size;
          break;
        case "preparing":
          queuedCount++;
          activeCount++;
          break;
        case "queued":
          queuedCount++;
          activeCount++;
          break;
        case "uploading":
          uploadingCount++;
          activeCount++;
          activeUploadedBytes += uploaded;
          break;
        case "processing":
          uploadingCount++;
          activeCount++;
          activeUploadedBytes += uploaded;
          break;
        case "retrying":
          activeCount++;
          uploadingCount++;
          activeUploadedBytes += uploaded;
          break;
        case "waiting_retry":
          activeCount++;
          queuedCount++;
          activeUploadedBytes += uploaded;
          break;
        case "failed":
          activeFailedCount++;
          activeUploadedBytes += uploaded;
          break;
        case "paused":
          pausedCount++;
          activeCount++;
          activeUploadedBytes += uploaded;
          break;
        case "cancelled":
          cancelledCount++;
          break;
        default:
          activeUploadedBytes += uploaded;
          break;
      }
    }

    // Combined historic + active stats
    const totalFiles = this.clearedTotalFiles + this.tasks.length;
    const uploadedCount = this.clearedCompletedCount + activeUploadedCount;
    const failedCount = activeFailedCount;
    const totalBytes = this.clearedTotalBytes + activeTotalBytes;
    const uploadedBytes = this.clearedUploadedBytes + activeUploadedBytes;

    const overallProgress =
      totalBytes > 0
        ? Math.round(Math.min((uploadedBytes / totalBytes) * 100, 100))
        : 0;
    const { avgUploadSpeedBps, currentUploadSpeedBps } =
      this.computeUploadSpeeds(uploadedBytes, uploadingCount > 0);

    return {
      totalFiles,
      uploadedCount,
      queuedCount,
      failedCount,
      activeCount,
      uploadingCount,
      pausedCount,
      cancelledCount,
      totalBytes,
      uploadedBytes,
      avgUploadSpeedBps,
      currentUploadSpeedBps,
      overallProgress,
    };
  }

  private computeUploadSpeeds(
    uploadedBytes: number,
    isActivelyUploading: boolean,
  ) {
    const now = Date.now();
    let currentUploadSpeedBps = 0;

    if (!isActivelyUploading) {
      this.speedSamples = [{ ts: now, uploadedBytes }];
      this.emaUploadSpeedBps = 0;
      this.lastSpeedSampleTs = now;
      return { avgUploadSpeedBps: 0, currentUploadSpeedBps: 0 };
    }

    if (
      !this.lastSpeedSampleTs ||
      now - this.lastSpeedSampleTs >= this.NOTIFY_THROTTLE_MS
    ) {
      this.speedSamples.push({ ts: now, uploadedBytes });
      this.lastSpeedSampleTs = now;
    }

    const cutoff = now - this.SPEED_WINDOW_MS;
    this.speedSamples = this.speedSamples.filter((s) => s.ts >= cutoff);

    if (this.speedSamples.length >= 2) {
      const first = this.speedSamples[0];
      const last = this.speedSamples[this.speedSamples.length - 1];
      const deltaBytes = Math.max(last.uploadedBytes - first.uploadedBytes, 0);
      const deltaTimeSec = Math.max((last.ts - first.ts) / 1000, 0.001);
      currentUploadSpeedBps = deltaBytes / deltaTimeSec;
    }

    if (currentUploadSpeedBps > 0) {
      const alpha = 0.4;
      this.emaUploadSpeedBps =
        this.emaUploadSpeedBps === 0
          ? currentUploadSpeedBps
          : alpha * currentUploadSpeedBps +
            (1 - alpha) * this.emaUploadSpeedBps;
    }

    return {
      avgUploadSpeedBps: Math.max(this.emaUploadSpeedBps, 0),
      currentUploadSpeedBps: Math.max(currentUploadSpeedBps, 0),
    };
  }

  // ── Notifications ─────────────────────────────────────────────────────────

  private lastNotificationAt = 0;
  private lastNotificationState = '';
  private notificationBusy = false;
  private async updateNotification() {
    if (nativeTransfer) return;
    if (!this.notificationsEnabled || this.notificationBusy) return;
    const stats = this.getStats();
    const state = this.tasks.map(t => t.id + ':' + t.status).join('|');
    if (state === this.lastNotificationState && Date.now() - this.lastNotificationAt < 5000) return;
    if (!stats.activeCount && state === this.lastNotificationState) return;
    this.notificationBusy = true;
    try {
      if (!(await getNotificationsEnabled())) return;
      if (!stats.activeCount) {
        await Notifications.dismissNotificationAsync('upload_progress');
        if (stats.uploadedCount || stats.failedCount) await Notifications.scheduleNotificationAsync({
          identifier: 'upload_result',
          content: { title: stats.failedCount ? 'Some uploads need attention' : 'Upload complete',
            body: stats.uploadedCount + ' uploaded' + (stats.failedCount ? ' · ' + stats.failedCount + ' failed. Open Axya to retry.' : ''),
            data: { type: 'upload_complete' }, color: '#4B6EF5' },
          trigger: Platform.OS === 'android' ? { channelId: 'upload_channel' } : null,
        });
      } else {
        const running = Math.max(0, stats.activeCount - stats.pausedCount);
        await Notifications.scheduleNotificationAsync({
          identifier: 'upload_progress',
          content: { title: running ? 'Axya · ' + Math.round(stats.overallProgress) + '%' : 'Uploads paused',
            body: [stats.uploadingCount ? stats.uploadingCount + ' uploading' : '', stats.queuedCount ? stats.queuedCount + ' queued' : '', stats.pausedCount ? stats.pausedCount + ' paused' : ''].filter(Boolean).join(' · '),
            categoryIdentifier: UPLOAD_NOTIFICATION_CATEGORY_ID,
            data: { type: 'upload_progress', progress: stats.overallProgress },
            sticky: running > 0, autoDismiss: false, sound: false, color: '#4B6EF5', priority: 'low' },
          trigger: Platform.OS === 'android' ? { channelId: 'upload_channel' } : null,
        });
      }
      this.lastNotificationState = state;
      this.lastNotificationAt = Date.now();
    } catch (error) { console.warn('[UploadManager] Notification unavailable:', error); }
    finally { this.notificationBusy = false; }
  }

  // ── Public API ────────────────────────────────────────────────────────────

  public addUploads(
    files: FileAsset[],
    folderId: string | null = null,
    chatTarget: string = "me",
  ) {
    // Dedup: skip files already in the queue (by fingerprint)
    const existingFingerprints = new Set(
      this.tasks
        .filter((t) =>
          [
            "preparing",
            "queued",
            "uploading",
            "processing",
            "retrying",
            "waiting_retry",
            "paused",
          ].includes(t.status),
        )
        .map((t) => t.fingerprint),
    );

    const newTasks: UploadTask[] = [];
    for (const rawFile of files) {
      const normalized = normalizeUploadFile(rawFile);
      const file: FileAsset = {
        uri: normalized.uri,
        name: normalized.name,
        size: Math.max(0, toFiniteNumber(rawFile?.size, 0)),
        mimeType: normalized.type,
      };
      const safeName = sanitizeFileName(file.name, "file");
      const fp = makeFingerprint(file);
      if (existingFingerprints.has(fp)) {
        console.log(`[UploadManager] Skipped duplicate: "${safeName}"`);
        continue;
      }
      existingFingerprints.add(fp);
      const now = Date.now();
      newTasks.push({
        id: this.makeTaskId(),
        file: {
          ...file,
          name: safeName,
          uri: normalized.uri,
          mimeType: normalized.type,
        },
        folderId,
        chatTarget,
        progress: 0,
        bytesUploaded: 0,
        status: "queued",
        retryCount: 0,
        fingerprint: fp,
        recovered: false,
        nativeOwned: !!nativeTransfer,
        createdAt: now,
        updatedAt: now,
      });
    }

    if (newTasks.length === 0) return;

    this.tasks.push(...newTasks);
    // Save every selection immediately, including files waiting behind workers.
    // Otherwise their browser blob/provider handles can expire before admission.
    const sourceOwner = this.ownerId || '';
    for (const task of newTasks) {
      const retention = retainUploadSource(sourceOwner, task.id, task.file.uri).then(saved => {
        if (this.ownerId !== sourceOwner) return;
        if (task.status === 'cancelled' || task.status === 'completed') {
          void discardUploadSource(sourceOwner, task.id).catch(() => {}); return;
        }
        task.file = { ...task.file, uri: saved.uri, size: saved.size };
        if (nativeTransfer) {
          void nativeTransfer.enqueue(sourceOwner, JSON.stringify([task])).catch(error => {
            this.updateTask(task.id, { status: 'failed', error: error.message || 'Could not start background upload.' });
          });
        }
        void this.saveQueue();
        this.notifyListeners(true);
      }).catch(error => {
        if (this.ownerId === sourceOwner && !['cancelled', 'completed'].includes(task.status)) {
          this.updateTask(task.id, { status: 'failed', error: error.message });
        }
      });
      this.sourceRetention.set(task.id, retention);
      void retention.finally(() => this.sourceRetention.delete(task.id));
    }
    this.notifyListeners(true);
    void this.processQueue();
    this.scheduleQueuePump();
  }

  public pause(id: string): boolean {
    const task = this.tasks.find((t) => t.id === id);
    if (!task) return false;
    if (task.nativeOwned && this.ownerId && nativeTransfer) {
      if (['completed', 'cancelled', 'failed'].includes(task.status)) return false;
      task.status = 'paused';
      void nativeTransfer.action(this.ownerId, id, 'pause').catch(() => {});
      this.notifyListeners(true); return true;
    }
    task.pausedForBackground = false;
    task.pausedForConnection = false;
    if (
      [
        "preparing",
        "queued",
        "uploading",
        "processing",
        "retrying",
        "waiting_retry",
      ].includes(task.status)
    ) {
      const ok = this.transition(task, "paused");
      if (!ok) return false;
      this.abortControllers.get(id)?.abort();
      this.notifyListeners(true);
      return true;
    }
    return false;
  }

  public resume(id: string) {
    const task = this.tasks.find((t) => t.id === id);
    if (!task) return;
    if (task.nativeOwned && this.ownerId && nativeTransfer) {
      const owner=this.ownerId, revision=this.accountRevision;
      const action=task.status==='failed'?'retry':'resume';
      task.status='queued';task.error=undefined;
      const retained=this.sourceRetention.get(id)||Promise.resolve();
      void retained.then(async()=>{
        if(owner!==this.ownerId||revision!==this.accountRevision||task.status!=='queued')return;
        await nativeTransfer.enqueue(owner,JSON.stringify([task]));
        await nativeTransfer.action(owner,id,action);await this.pollNative();
      }).catch(e=>{if(owner===this.ownerId)this.updateTask(id,{status:'failed',error:e.message||'Upload could not resume.'});});
      this.notifyListeners(true);
      return;
    }
    if (task.status === "paused") {
      if (this.networkOffline) {
        task.pausedForConnection = true;
        task.error = 'Waiting for internet. Upload resumes automatically.';
        this.notifyListeners(true); return;
      }
      task.pausedForBackground = false;
      task.pausedForConnection = false;
      this.transition(task, "queued");
      task.error = undefined;
      task.recovered = false;
      this.resetTaskTelemetry(task.id);
      this.notifyListeners(true);
      this.scheduleQueuePump();
      return;
    }

    if (task.status === "failed") {
      // Failed sessions can be invalid server-side, so start fresh.
      if (task.uploadId) {
        uploadClient
          .post("/files/upload/cancel", { uploadId: task.uploadId })
          .catch(() => {});
      }
      this.transition(task, "queued");
      task.retryCount = 0;
      task.error = undefined;
      task.progress = 0;
      task.bytesUploaded = 0;
      task.uploadId = undefined;
      task.recovered = false;
      this.resetTaskTelemetry(task.id);
      this.notifyListeners(true);
      this.scheduleQueuePump();
    }
  }

  public cancel(id: string) {
    const task = this.tasks.find((t) => t.id === id);
    if (!task) return;
    if (task.nativeOwned && this.ownerId) void nativeTransfer?.action(this.ownerId, id, 'cancel').catch(() => {});
    if (["completed", "cancelled"].includes(task.status)) return;
    this.transition(task, "cancelled");
    this.abortControllers.get(id)?.abort();
    void discardUploadSource(this.ownerId || "", task.id).catch(() => {});

    // Tell the server to cancel the async Telegram upload
    if (task.uploadId) {
      uploadClient
        .post("/files/upload/cancel", { uploadId: task.uploadId })
        .catch(() => {});
    }

    this.notifyListeners(true);
    this.scheduleQueuePump();
  }

  public cancelAll() {
    this.tasks.forEach((task) => {
      if (!["completed", "failed", "cancelled"].includes(task.status)) {
        this.transition(task, "cancelled");
        this.abortControllers.get(task.id)?.abort();
        void discardUploadSource(this.ownerId || "", task.id).catch(() => {});
        if (task.uploadId) {
          uploadClient
            .post("/files/upload/cancel", { uploadId: task.uploadId })
            .catch(() => {});
        }
      }
    });
    this.notifyListeners(true);
  }

  public pauseAll() {
    let changed = false;
    this.tasks.forEach((task) => {
      if (this.pause(task.id)) {
        changed = true;
      }
    });
    if (changed) this.notifyListeners(true);
  }

  public resumeAll() {
    let changed = false;
    this.tasks.forEach((task) => {
      if (task.status === "paused" || task.status === "failed") {
        this.resume(task.id);
        changed = true;
      }
    });
    if (changed) this.notifyListeners(true);
  }

  public pauseAllBackground() {
    let changed = false;
    this.tasks.forEach((task) => {
      if (
        [
          "preparing",
          "queued",
          "uploading",
          "processing",
          "retrying",
          "waiting_retry",
        ].includes(task.status)
      ) {
        if (this.pause(task.id)) {
          task.pausedForBackground = true;
          changed = true;
        }
      }
    });
    if (changed) {
      this.notifyListeners(true);
    }
  }

  public clearCompleted() {
    if (nativeTransfer && this.ownerId) void nativeTransfer.clearFinished(this.ownerId).catch(() => {});
    this.tasks.forEach((t) => {
      if (
        t.status === "completed" ||
        t.status === "cancelled"
      ) {
        this.updateHistoricalStatsBeforeClear(t);
        void discardUploadSource(this.ownerId || "", t.id).catch(() => {});
      }
    });

    this.tasks = this.tasks.filter(
      (t) =>
        t.status !== "completed" &&
        t.status !== "cancelled",
    );
    this.notifyListeners(true);
  }

  public retryFailed() {
    this.tasks
      .filter((t) => t.status === "failed")
      .forEach((t) => {
        // Cancel stale server session
        if (t.uploadId) {
          uploadClient
            .post("/files/upload/cancel", { uploadId: t.uploadId })
            .catch(() => {});
        }
        this.transition(t, "queued");
        t.retryCount = 0;
        t.error = undefined;
        t.progress = 0;
        t.bytesUploaded = 0;
        t.uploadId = undefined;
        t.recovered = false;
        this.resetTaskTelemetry(t.id);
      });
    this.notifyListeners(true);
    this.scheduleQueuePump();
  }

  // ── Queue Processor ───────────────────────────────────────────────────────

  private updateHistoricalStatsBeforeClear(task: UploadTask) {
    this.clearedTotalFiles++;
    this.clearedTotalBytes += Math.max(task.file.size || 1, 1);

    if (task.status === "completed" || task.duplicate) {
      this.clearedCompletedCount++;
      this.clearedUploadedBytes += Math.max(task.file.size || 1, 1);
    } else if (task.status === "failed") {
      this.clearedFailedCount++;
    }
  }

  private scheduleTaskClearing(task: UploadTask, delayMs: number = 3000) {
    if (delayMs <= 0) return;
    setTimeout(() => {
      const currentTask = this.tasks.find((x) => x.id === task.id);
      if (!currentTask) return; // already cleared by clearCompleted()

      // Allow clearing completed, duplicate or cancelled tasks
      if (["completed", "cancelled"].includes(currentTask.status)) {
        this.updateHistoricalStatsBeforeClear(currentTask);
        this.tasks = this.tasks.filter((x) => x.id !== task.id);
        this.notifyListeners(true);
      }
    }, delayMs);
  }

  private pruneTerminalTaskHistory() {
    const terminal = this.tasks.filter((t) =>
      ["completed", "cancelled"].includes(t.status),
    );
    if (terminal.length <= this.MAX_TERMINAL_HISTORY) return;

    const terminalSet = new Set(terminal.map((t) => t.id));
    const terminalSorted = [...terminal].sort(
      (a, b) =>
        (a.completedAt || a.updatedAt || 0) -
        (b.completedAt || b.updatedAt || 0),
    );
    const removeCount = terminalSorted.length - this.MAX_TERMINAL_HISTORY;
    const removeIds = new Set(
      terminalSorted.slice(0, removeCount).map((t) => t.id),
    );
    this.tasks = this.tasks.filter(
      (t) => !(terminalSet.has(t.id) && removeIds.has(t.id)),
    );
  }

  private async processQueue(): Promise<void> {
    if (!this.ownerId || !this.queueReady) return;
    if (nativeTransfer) return;
    if (this.networkOffline) {
      this.handleConnectivity({ isConnected: false }); return;
    }
    // ✅ No boolean lock — use activeUploads count as the sole concurrency gate.
    // This allows up to MAX_CONCURRENT parallel processQueue calls.
    const targetConcurrency = this.getAdaptiveConcurrency();
    if (this.inFlightTaskIds.size >= targetConcurrency) return;

    const runnableWindowIds = this.getRunnableWindowTaskIds();

    const nextTask = this.tasks.find(
      (t) =>
        (t.status === "preparing" ||
          t.status === "queued" ||
          t.status === "retrying") &&
        !this.inFlightTaskIds.has(t.id) &&
        runnableWindowIds.has(t.id),
    );
    if (!nextTask) {
      // Starvation guard: if current window is blocked by paused/retrying tasks,
      // keep progress moving by allowing the oldest runnable task outside window.
      const fallbackTask = this.tasks.find(
        (t) =>
          (t.status === "preparing" ||
            t.status === "queued" ||
            t.status === "retrying") &&
          !this.inFlightTaskIds.has(t.id),
      );
      if (!fallbackTask) return;
      this.inFlightTaskIds.add(fallbackTask.id);

      this.updateTask(fallbackTask.id, {
        status: "preparing",
        error: undefined,
        progress: fallbackTask.bytesUploaded > 0 ? clampProgress(fallbackTask.progress) : 0,
      });

      const fallbackOwner = this.ownerId || "";
      const fallbackRevision = this.accountRevision;
      const heartbeat = setInterval(() => {
        if (fallbackTask.uploadId && fallbackTask.status === 'uploading') {
          void apiClient.post('/files/upload/heartbeat', {uploadId:fallbackTask.uploadId}, {timeout:20_000}).catch(() => {});
        }
      }, 30_000);
      try {
        await this.performUpload(fallbackTask);
        if (fallbackOwner !== this.ownerId || fallbackRevision !== this.accountRevision) return;
        if (["paused", "cancelled"].includes(fallbackTask.status)) return;
        this.updateTask(fallbackTask.id, {
          status: "completed",
          progress: 100,
          bytesUploaded: fallbackTask.file.size,
          currentSpeedBps: 0,
          etaSeconds: 0,
          completedAt: Date.now(),
        });
        void discardUploadSource(fallbackOwner, fallbackTask.id).catch(() => {});
      syncAfterFileMutation();
        this.pruneTerminalTaskHistory();
        this.scheduleTaskClearing(fallbackTask, 8000);
      } catch (e: any) {
        if (fallbackOwner === this.ownerId && fallbackRevision === this.accountRevision) this.handleUploadError(fallbackTask, e);
      } finally {
        clearInterval(heartbeat);
        if (fallbackRevision === this.accountRevision) {
          this.abortControllers.delete(fallbackTask.id);
          this.inFlightTaskIds.delete(fallbackTask.id);
        }
        if (fallbackTask.status !== "waiting_retry") {
          this.scheduleQueuePump();
        }
      }
      return;
    }
    if (!nextTask) return;

    this.inFlightTaskIds.add(nextTask.id);

    // Mark this task as preparing; inFlightTaskIds owns its concurrency slot.
    this.updateTask(nextTask.id, {
      status: "preparing",
      error: undefined,
      progress: nextTask.bytesUploaded > 0 ? clampProgress(nextTask.progress) : 0,
    });

    const taskOwner = this.ownerId || "";
    const taskRevision = this.accountRevision;
    const heartbeat = setInterval(() => {
      if (nextTask.uploadId && nextTask.status === 'uploading') {
        void apiClient.post('/files/upload/heartbeat', {uploadId:nextTask.uploadId}, {timeout:20_000}).catch(() => {});
      }
    }, 30_000);
    try {
      await this.performUpload(nextTask);
      if (taskOwner !== this.ownerId || taskRevision !== this.accountRevision) return;
      // performUpload can stop cleanly when pause/cancel wins a status poll.
      // A resolved promise alone does not mean Telegram delivery completed.
      if (["paused", "cancelled"].includes(nextTask.status)) return;
      this.updateTask(nextTask.id, {
        status: "completed",
        progress: 100,
        bytesUploaded: nextTask.file.size,
        currentSpeedBps: 0,
        etaSeconds: 0,
        completedAt: Date.now(),
      });
      void discardUploadSource(taskOwner, nextTask.id).catch(() => {});
      syncAfterFileMutation();
      this.pruneTerminalTaskHistory();
      this.scheduleTaskClearing(nextTask, 8000);
    } catch (e: any) {
      if (taskOwner === this.ownerId && taskRevision === this.accountRevision) this.handleUploadError(nextTask, e);
    } finally {
      clearInterval(heartbeat);
      if (taskRevision === this.accountRevision) {
        this.abortControllers.delete(nextTask.id);
        this.inFlightTaskIds.delete(nextTask.id);
      }
      // ✅ Don't chain processQueue when retrying
      // — the retry timer will handle it after the backoff delay
      if (nextTask.status !== "waiting_retry") {
        this.scheduleQueuePump();
      }
    }
  }

  /**
   * Shared error handler for upload tasks — deduplicates error classification,
   * retry scheduling, and terminal state transitions from processQueue.
   */
  private handleUploadError(task: UploadTask, e: any) {
    const status = task.status as UploadStatus;

    const isCancelOrPauseError =
      e?.name === "AbortError" || e?.message === "Cancelled";
    const isFatalSchemaError =
      e?.message?.includes("constraint") ||
      e?.message?.includes("duplicate key");
    const isFatalTelegramError =
      e?.message?.includes("FILE_PARTS_INVALID") ||
      e?.message?.includes("FILE_REFERENCE_EXPIRED") ||
      e?.message?.includes("MEDIA_EMPTY") ||
      e?.message?.includes("FILE_ID_INVALID") ||
      (e?.message?.includes("400:") && !e?.message?.includes("FLOOD"));
    const isFatalUploadError = this.isFatalUploadError(e);

    if (isCancelOrPauseError || status === "cancelled") {
      // A rapid resume can queue this same task before the aborted worker exits.
      if (isCancelOrPauseError && status === 'queued') return;
      if (status !== "paused") {
        this.updateTask(task.id, {
          status: "cancelled",
          currentSpeedBps: 0,
          etaSeconds: 0,
          completedAt: Date.now(),
        });
        this.pruneTerminalTaskHistory();
      }
    } else if (status === "paused") {
      // Keep paused — UI initiated pause during upload
    } else if (
      isFatalSchemaError ||
      isFatalTelegramError ||
      isFatalUploadError
    ) {
      if (task.uploadId) {
        uploadClient
          .post("/files/upload/cancel", { uploadId: task.uploadId })
          .catch(() => {});
      }
      this.updateTask(task.id, {
        status: "failed",
        error: this.toUserFacingUploadError(e),
        currentSpeedBps: 0,
        etaSeconds: 0,
        completedAt: Date.now(),
      });
    } else {
      const newRetryCount = task.retryCount + 1;
      if (newRetryCount <= this.MAX_RETRIES) {
        const errorStatus = Number(e?.response?.status || 0);
        const errorMessage = String(
          e?.response?.data?.error || e?.message || "",
        ).toLowerCase();
        const resetSession =
          errorStatus === 404 ||
          errorMessage.includes("upload session not found");

        if (resetSession && task.uploadId) {
          try {
            uploadClient
              .post("/files/upload/cancel", { uploadId: task.uploadId })
              .catch(() => {});
          } catch {}
        }
        this.updateTask(task.id, {
          status: "waiting_retry",
          retryCount: newRetryCount,
          error: `Retrying upload (attempt ${newRetryCount} of ${this.MAX_RETRIES})`,
          uploadId: resetSession ? undefined : task.uploadId,
          progress: resetSession ? 0 : task.progress,
          bytesUploaded: resetSession ? 0 : task.bytesUploaded,
        });
        const delay = Math.min(60_000, (Math.pow(2, newRetryCount) + 1) * 1000)
          + Math.floor(Math.random() * 1000);
        console.warn(
          `[UploadManager] Retry ${newRetryCount}/${this.MAX_RETRIES}`,
          `"${task.file.name}" in ${delay / 1000}s:`,
          e?.message,
        );
        const retryOwner = this.ownerId;
        const retryRevision = this.accountRevision;
        setTimeout(() => {
          if (retryOwner !== this.ownerId || retryRevision !== this.accountRevision) return;
          const t = this.tasks.find((x) => x.id === task.id);
          if (t && t.status === "waiting_retry") {
            this.updateTask(t.id, { status: "retrying" });
            this.processQueue();
          } else {
            this.processQueue();
          }
        }, delay);
      } else {
        this.updateTask(task.id, {
          status: "failed",
          error: this.toUserFacingUploadError(e),
          currentSpeedBps: 0,
          etaSeconds: 0,
          completedAt: Date.now(),
        });
      }
    }
  }

  // ── Core Upload Logic ─────────────────────────────────────────────────────

  private async performUpload(task: UploadTask): Promise<void> {
    // Fence the worker before source preparation can yield to an account switch.
    const sourceOwner = this.ownerId || '';
    const sourceRevision = this.accountRevision;
    const abort = new AbortController();
    this.abortControllers.set(task.id, abort);

    const isCancelled = () =>
      sourceOwner !== this.ownerId || sourceRevision !== this.accountRevision ||
      task.status === "cancelled" ||
      task.status === "paused" ||
      abort.signal.aborted;

    const throwIfCancelled = () => {
      if (isCancelled()) throw new Error("Cancelled");
    };

    await this.sourceRetention.get(task.id);
    throwIfCancelled();
    if (task.status === 'failed') throw new Error(task.error || 'Could not retain selected file.');
    let retainedBlob: Blob | undefined;
    const normalizedFile = normalizeUploadFile(task.file);
    const file: FileAsset = {
      ...task.file,
      uri: normalizedFile.uri,
      name: normalizedFile.name,
      mimeType: normalizedFile.type,
    };
    const { folderId, chatTarget } = task;
    if (
      file.uri !== task.file.uri ||
      file.name !== task.file.name ||
      file.mimeType !== task.file.mimeType
    ) {
      this.updateTask(task.id, { file: { ...task.file, ...file } });
    }

    // ── Step 0: Resolve file size if DocumentPicker returned 0 ────────
    if (!file.size || file.size <= 0) {
      const retained = await retainUploadSource(sourceOwner, task.id, file.uri);
      retainedBlob = retained.blob;
      file.uri = retained.uri;
      file.size = retained.size;
      if (Platform.OS !== "web" && file.uri.startsWith("file://")) {
        try {
          const fileObj = new File(file.uri);
          file.size = fileObj.size ?? 0;
        } catch {
          /* fallthrough */
        }
      }
      if (!file.size || file.size <= 0) {
        throw new Error("File has 0 bytes — cannot upload an empty file");
      }
    }

    // ── Step 1: MD5 hash for deduplication ──────────────────────────────
    // Android's File.md5 currently calls readBytes() for the entire file.
    // Bound this optional fast deduplication check; the backend hashes every
    // completed file as a stream, including files skipped here.
    let fileHash = "";
    if (Platform.OS !== "web" && file.size <= 8 * 1024 * 1024) {
      try {
        const fileObj = new File(file.uri);
        fileHash = fileObj.md5 ?? "";
      } catch {
        // Optional — proceed without hash
      }
    }

    throwIfCancelled();

    const connection = typeof navigator !== "undefined" ? (navigator as any).connection : undefined;
    let chunkSize = task.chunkSizeBytes || (["slow-2g", "2g"].includes(connection?.effectiveType) ? 256*1024 : connection?.effectiveType === "3g" ? 1024*1024 : this.CHUNK_SIZE);
    task.chunkSizeBytes = chunkSize;
    let uploadId = String(task.uploadId || "").trim();
    let offset = Math.max(0, Number(task.bytesUploaded || 0));
    let chunkIndex = Math.max(0, Math.floor(offset / chunkSize));
    let telegramFinalizingAlready = false;
    let serverQueued = false;

    // Try to recover server-side in-flight session so pause/resume and retry
    // continue from the latest acknowledged chunk.
    if (uploadId) {
      try {
        const resumeStatus = await apiClient.get(
          `/files/upload/status/${uploadId}`,
          {
            signal: abort.signal,
            _maxRetries: 0,
            timeout: 60_000,
          } as any,
        );
        let resumeData = resumeStatus?.data || {};
        chunkSize = Number(resumeData.chunkSizeBytes) || chunkSize; task.chunkSizeBytes = chunkSize;
        let remoteStatus = String(resumeData.status || "").toLowerCase();
        if (remoteStatus === "paused") {
          // The server pauses disconnected clients to free admission slots.
          // A foreground retry must explicitly reacquire one before sending.
          const resumed = await uploadClient.post(
            "/files/upload/resume-paused",
            { uploadId },
            { signal: abort.signal },
          );
          resumeData = resumed?.data || {};
          remoteStatus = String(resumeData.status || "").toLowerCase();
        }

        if (remoteStatus === "completed") {
          this.updateTask(task.id, {
            progress: 100,
            bytesUploaded: file.size,
          });
          return;
        }

        if (remoteStatus === "error" || remoteStatus === "cancelled") {
          uploadId = "";
          task.uploadId = undefined;
          offset = 0;
          chunkIndex = 0;
        } else {
          const remoteBytes = Math.max(
            0,
            Number(resumeData.receivedBytes || 0),
          );
          const remoteExpectedChunk = Math.max(
            0,
            Number(
              resumeData.nextExpectedChunk ??
                Math.floor(remoteBytes / chunkSize),
            ),
          );
          offset = Math.min(file.size, remoteExpectedChunk * chunkSize);
          chunkIndex = remoteExpectedChunk;

          if (offset > 0) {
            this.updateTaskProgressWithTelemetry(
              task,
              offset,
              Math.round(Math.min((offset / file.size) * 50, 50)),
            );
          }

          serverQueued = remoteStatus === "queued";
          telegramFinalizingAlready =
            remoteStatus === "processing" ||
            remoteStatus === "uploading_to_telegram";
          if (telegramFinalizingAlready) {
            offset = file.size;
            this.updateTask(task.id, {
              status: "processing",
              queuePositionGlobal: 0,
              queuePositionUser: 0,
            });
          } else if (serverQueued) {
            this.updateTask(task.id, {
              queuePositionGlobal: Math.max(
                0,
                Number(resumeData.queuePositionGlobal || 0),
              ),
              queuePositionUser: Math.max(
                0,
                Number(resumeData.queuePositionUser || 0),
              ),
            });
          } else {
            this.updateTask(task.id, {
              status: "uploading",
              queuePositionGlobal: 0,
              queuePositionUser: 0,
            });
          }
        }
      } catch (resumeErr: any) {
        const resumeStatusCode = Number(resumeErr?.response?.status || 0);
        if (resumeStatusCode === 404 || resumeStatusCode === 403) {
          uploadId = "";
          task.uploadId = undefined;
          offset = 0;
          chunkIndex = 0;
          this.updateTask(task.id, { progress: 0, bytesUploaded: 0 });
        } else {
          throw resumeErr;
        }
      }
    }

    // A processing upload already has all bytes on the server and needs only polling.
    // For sending bytes, keep an account-scoped source across app/browser restarts.
    if (!telegramFinalizingAlready) {
      const retained = await retainUploadSource(sourceOwner, task.id, file.uri);
      retainedBlob = retained.blob;
      if (file.size > 0 && retained.size !== file.size) throw new Error('The selected file size changed. Select it again.');
      file.uri = retained.uri;
      file.size = retained.size;
      this.updateTask(task.id, {file: {...file}});
    }

    // ── Step 2: Init upload session ──────────────────────────────────────
    if (!uploadId) {
      const initRes = await uploadClient.post(
        "/files/upload/init",
        {
          originalname: sanitizeFileName(file.name),
          client_upload_key: task.id,
          size: file.size,
          mimetype: file.mimeType || "application/octet-stream",
          telegram_chat_id: chatTarget,
          folder_id: folderId,
          hash: fileHash,
          chunk_size_bytes: chunkSize,
        },
        { signal: abort.signal },
      );

      if (initRes.data.duplicate) {
        this.updateTask(task.id, {
          progress: 100,
          bytesUploaded: file.size,
          duplicate: true,
        });
        return;
      }

      uploadId = String(initRes.data?.uploadId || "").trim();
      task.uploadId = uploadId;
      chunkSize = Number(initRes.data?.chunkSizeBytes) || chunkSize;task.chunkSizeBytes = chunkSize;
      this.updateTask(task.id, { uploadId });
      await this.saveQueue();
      offset = 0;
      chunkIndex = 0;
      const initStatus = String(initRes.data?.status || "").toLowerCase();
      serverQueued = initStatus === "queued";
      telegramFinalizingAlready = initStatus === "processing";
      if (serverQueued) {
        this.updateTask(task.id, {
          status: "queued",
          error: undefined,
          queuePositionGlobal: Math.max(
            0,
            Number(initRes.data?.queuePositionGlobal || 0),
          ),
          queuePositionUser: Math.max(
            0,
            Number(initRes.data?.queuePositionUser || 0),
          ),
        });
      } else if (telegramFinalizingAlready) {
        this.updateTask(task.id, {
          status: "processing",
          progress: Math.max(task.progress, 50),
          queuePositionGlobal: 0,
          queuePositionUser: 0,
        });
      } else {
        this.updateTask(task.id, {
          status: "uploading",
          queuePositionGlobal: 0,
          queuePositionUser: 0,
        });
      }
    }

    // ── Step 3: Upload chunks ────────────────────────────────────────────
    // Progress 0-50% = chunk upload phase (real bytes sent)
    // Progress 50-100% = server-side Telegram delivery (polled)

    const waitForQueueAdmission = async () => {
      while (serverQueued) {
        throwIfCancelled();
        const statusRes = await apiClient.get(
          `/files/upload/status/${uploadId}`,
          { signal: abort.signal, _maxRetries: 0, timeout: 60_000 } as any,
        );
        let statusData = statusRes?.data || {};
        let statusValue = String(statusData.status || "").toLowerCase();
        if (statusValue === "paused") {
          const resumed = await uploadClient.post(
            "/files/upload/resume-paused",
            { uploadId },
            { signal: abort.signal },
          );
          statusData = resumed?.data || {};
          statusValue = String(statusData.status || "").toLowerCase();
        }

        if (statusValue === "completed") {
          this.updateTask(task.id, {
            status: "completed",
            progress: 100,
            bytesUploaded: file.size,
            currentSpeedBps: 0,
            etaSeconds: 0,
          });
          return;
        }
        if (statusValue === "error" || statusValue === "cancelled") {
          throw new Error(
            String(statusData.error || "Upload failed while queued"),
          );
        }

        if (statusValue === "queued") {
          this.updateTask(task.id, {
            status: "queued",
            error: undefined,
            queuePositionGlobal: Math.max(
              0,
              Number(statusData.queuePositionGlobal || 0),
            ),
            queuePositionUser: Math.max(
              0,
              Number(statusData.queuePositionUser || 0),
            ),
          });
          const waitMs = this.clampRecommendedMs(
            statusData.recommendedPollMs,
            1500,
            10000,
            3000,
          );
          await this.delayWithAbort(waitMs, abort.signal);
          continue;
        }

        serverQueued = false;
        if (
          statusValue === "processing" ||
          statusValue === "uploading_to_telegram"
        ) {
          telegramFinalizingAlready = true;
          this.updateTask(task.id, {
            status: "processing",
            progress: Math.max(task.progress, 50),
            queuePositionGlobal: 0,
            queuePositionUser: 0,
          });
          return;
        }

        this.updateTask(task.id, {
          status: "uploading",
          error: undefined,
          queuePositionGlobal: 0,
          queuePositionUser: 0,
        });
        return;
      }
    };

    if (uploadId && serverQueued) {
      await waitForQueueAdmission();
      if (task.status === "completed") {
        return;
      }
    }

    if (Platform.OS === "web") {
      // Web: Blob.slice chunking via fetch + FormData
      const blob = retainedBlob || (await retainUploadSource(sourceOwner, task.id, file.uri)).blob;
      if (!blob) throw new Error('The selected file is no longer available. Select it again.');
      if (blob.size !== file.size) throw new Error('The selected file size changed. Select it again.');

      while (offset < file.size) {
        throwIfCancelled();
        const chunk = blob.slice(offset, offset + chunkSize);
        const formData = new FormData();
        formData.append("uploadId", uploadId);
        formData.append("chunkIndex", String(chunkIndex));
        formData.append(
          "chunk",
          new globalThis.File([chunk], sanitizeFileName(file.name), {
            type: file.mimeType || "application/octet-stream",
          }),
        );

        try {
          const chunkRes = await uploadClient.post(
            "/files/upload/chunk",
            formData,
            {
              signal: abort.signal,
              onUploadProgress: (progressEvent: any) => {
                const fraction = this.resolveProgressFraction(
                  progressEvent,
                  chunk.size || chunkSize,
                );
                const uploadedBytes =
                  offset + Math.round(chunk.size * fraction);
                this.updateTaskProgressWithTelemetry(
                  task,
                  uploadedBytes,
                  Math.round(Math.min((uploadedBytes / file.size) * 50, 50)),
                );
              },
            },
          );

          const recommendedDelayMs = this.clampRecommendedMs(
            chunkRes?.data?.recommendedChunkDelayMs,
            0,
            1000,
            0,
          );
          if (recommendedDelayMs > 0) {
            await this.delayWithAbort(recommendedDelayMs, abort.signal);
          }
        } catch (chunkErr: any) {
          if (Number(chunkErr?.response?.status || 0) === 409) {
            const code = String(
              chunkErr?.response?.data?.code || "",
            ).toUpperCase();
            if (code === "UPLOAD_QUEUED") {
              this.updateTask(task.id, {
                status: "queued",
                error: undefined,
                queuePositionGlobal: Math.max(
                  0,
                  Number(chunkErr?.response?.data?.queuePositionGlobal || 0),
                ),
                queuePositionUser: Math.max(
                  0,
                  Number(chunkErr?.response?.data?.queuePositionUser || 0),
                ),
              });
              serverQueued = true;
              await waitForQueueAdmission();
              if (["completed", "paused", "cancelled"].includes(task.status)) {
                return;
              }
              continue;
            }
            const expectedChunk = Number(
              chunkErr?.response?.data?.expectedChunk,
            );
            if (Number.isFinite(expectedChunk) && expectedChunk >= 0) {
              chunkIndex = expectedChunk;
              offset = Math.min(file.size, expectedChunk * chunkSize);
              this.updateTaskProgressWithTelemetry(
                task,
                offset,
                Math.round(Math.min((offset / file.size) * 50, 50)),
              );
              continue;
            }
          }
          throw chunkErr;
        }

        offset = Math.min(offset + chunkSize, file.size);
        chunkIndex++;
        this.updateTaskProgressWithTelemetry(
          task,
          offset,
          Math.round(Math.min((offset / file.size) * 50, 50)),
        );
      }
    } else {
      // Native (iOS/Android): write chunk to temp file, upload via FormData
      while (offset < file.size) {
        throwIfCancelled();

        const length = Math.min(chunkSize, file.size - offset);
        const tmpChunkPath = await writeChunkToTempFile(
          file.uri,
          offset,
          length,
          chunkIndex,
        );

        throwIfCancelled();

        try {
          const formData = new FormData();
          formData.append("uploadId", uploadId);
          formData.append("chunkIndex", String(chunkIndex));
          formData.append("chunk", {
            uri: tmpChunkPath,
            name: sanitizeFileName(file.name),
            type: file.mimeType || "application/octet-stream",
          } as any);

          const chunkRes = await uploadClient.post(
            "/files/upload/chunk",
            formData,
            {
              signal: abort.signal,
              onUploadProgress: (progressEvent: any) => {
                const fraction = this.resolveProgressFraction(
                  progressEvent,
                  length,
                );
                const uploadedBytes = offset + Math.round(length * fraction);
                this.updateTaskProgressWithTelemetry(
                  task,
                  uploadedBytes,
                  Math.round(Math.min((uploadedBytes / file.size) * 50, 50)),
                );
              },
            },
          );

          const recommendedDelayMs = this.clampRecommendedMs(
            chunkRes?.data?.recommendedChunkDelayMs,
            0,
            1000,
            0,
          );
          if (recommendedDelayMs > 0) {
            await this.delayWithAbort(recommendedDelayMs, abort.signal);
          }
        } catch (chunkErr: any) {
          if (Number(chunkErr?.response?.status || 0) === 409) {
            const code = String(
              chunkErr?.response?.data?.code || "",
            ).toUpperCase();
            if (code === "UPLOAD_QUEUED") {
              this.updateTask(task.id, {
                status: "queued",
                error: undefined,
                queuePositionGlobal: Math.max(
                  0,
                  Number(chunkErr?.response?.data?.queuePositionGlobal || 0),
                ),
                queuePositionUser: Math.max(
                  0,
                  Number(chunkErr?.response?.data?.queuePositionUser || 0),
                ),
              });
              serverQueued = true;
              await waitForQueueAdmission();
              if (["completed", "paused", "cancelled"].includes(task.status)) {
                return;
              }
              continue;
            }
            const expectedChunk = Number(
              chunkErr?.response?.data?.expectedChunk,
            );
            if (Number.isFinite(expectedChunk) && expectedChunk >= 0) {
              chunkIndex = expectedChunk;
              offset = Math.min(file.size, expectedChunk * chunkSize);
              this.updateTaskProgressWithTelemetry(
                task,
                offset,
                Math.round(Math.min((offset / file.size) * 50, 50)),
              );
              continue;
            }
          }
          throw chunkErr;
        } finally {
          // Always clean up the temp chunk file
          try {
            const chunkFile = new File(tmpChunkPath);
            if (chunkFile.exists) chunkFile.delete();
          } catch { /* Temporary cleanup must not fail a delivered chunk. */ }
        }

        offset += length;
        chunkIndex++;
        this.updateTaskProgressWithTelemetry(
          task,
          offset,
          Math.round(Math.min((offset / file.size) * 50, 50)),
        );
      }
    }

    throwIfCancelled();
    this.updateTaskProgressWithTelemetry(
      task,
      Math.max(offset, Math.min(file.size, task.bytesUploaded || 0)),
      50,
    );

    // ── Step 4: Finalise on server ───────────────────────────────────────
    try {
      const completeRes = await uploadClient.post(
        "/files/upload/complete",
        { uploadId },
        { signal: abort.signal },
      );
      const completeStatus = String(
        completeRes?.data?.status || "",
      ).toLowerCase();
      if (completeStatus === "completed") {
        this.updateTask(task.id, {
          status: "completed",
          progress: 100,
          bytesUploaded: file.size,
          queuePositionGlobal: 0,
          queuePositionUser: 0,
        });
        return;
      }
      if (
        completeStatus === "processing" ||
        completeStatus === "uploading_to_telegram"
      ) {
        this.updateTask(task.id, {
          status: "processing",
          queuePositionGlobal: 0,
          queuePositionUser: 0,
        });
      }
    } catch (completeErr: any) {
      const completeStatus = Number(completeErr?.response?.status || 0);
      const completeCode = String(
        completeErr?.response?.data?.code || "",
      ).toUpperCase();
      if (completeStatus === 409 && completeCode === "UPLOAD_QUEUED") {
        this.updateTask(task.id, {
          status: "queued",
          error: undefined,
          queuePositionGlobal: Math.max(
            0,
            Number(completeErr?.response?.data?.queuePositionGlobal || 0),
          ),
          queuePositionUser: Math.max(
            0,
            Number(completeErr?.response?.data?.queuePositionUser || 0),
          ),
        });
        serverQueued = true;
        await waitForQueueAdmission();
        if (task.status === "completed") {
          return;
        }
        if (task.status === "processing" || task.status === "uploading") {
          this.updateTask(task.id, {
            status: "processing",
            queuePositionGlobal: 0,
            queuePositionUser: 0,
          });
        }
      } else {
        throw completeErr;
      }
    }

    // ── Step 5: Poll Telegram delivery status (50% → 100%) ───────────────
    // Server confirms DB entry + Telegram delivery — success only on server OK
    await new Promise<void>((resolve, reject) => {
      const maxWait = Date.now() + 10 * 60 * 1000;
      let settled = false;
      let pollTimerId: ReturnType<typeof setTimeout> | null = null;

      const settle = (fn: () => void) => {
        if (settled) return;
        settled = true;
        if (pollTimerId) {
          clearTimeout(pollTimerId);
          pollTimerId = null;
        }
        fn();
      };

      const poll = async () => {
        if (settled) return;
        if (isCancelled() || Date.now() > maxWait) {
          settle(() =>
            reject(
              new Error(
                Date.now() > maxWait ? "Upload timed out" : "Cancelled",
              ),
            ),
          );
          return;
        }

        try {
          const res = await apiClient.get(`/files/upload/status/${uploadId}`, {
            signal: abort.signal,
            _maxRetries: 0,
            timeout: 60_000,
          } as any);
          const statusPayload = res.data || {};
          const status = String(statusPayload.status || "").toLowerCase();
          const tgProgress = Number(statusPayload.progress || 0);
          const tgError = statusPayload.error;
          const errorCode = statusPayload.errorCode;
          let nextPollMs = this.clampRecommendedMs(
            statusPayload.recommendedPollMs,
            1200,
            10000,
            2200,
          );

          if (status === "completed") {
            this.updateTask(task.id, {
              progress: 100,
              bytesUploaded: file.size,
              queuePositionGlobal: 0,
              queuePositionUser: 0,
            });
            settle(() => resolve());
            return;
          } else if (
            status === "failed" ||
            status === "error" ||
            status === "cancelled"
          ) {
            const err = new Error(tgError || "Telegram upload failed") as any;
            if (errorCode) err.code = errorCode;
            if (typeof res.data?.retryable === "boolean") {
              err.response = {
                data: {
                  retryable: res.data.retryable,
                  code: errorCode,
                  error: tgError,
                },
              };
            }
            settle(() => reject(err));
            return;
          } else if (status === "queued") {
            this.updateTask(task.id, {
              status: "queued",
              error: undefined,
              queuePositionGlobal: Math.max(
                0,
                Number(statusPayload.queuePositionGlobal || 0),
              ),
              queuePositionUser: Math.max(
                0,
                Number(statusPayload.queuePositionUser || 0),
              ),
            });
            nextPollMs = this.clampRecommendedMs(
              statusPayload.recommendedPollMs,
              1500,
              10000,
              3200,
            );
          } else if (
            status === "processing" ||
            status === "uploading_to_telegram"
          ) {
            const pollProgress = Math.round(50 + (tgProgress || 0) * 0.5);
            this.updateTask(task.id, {
              status: "processing",
              queuePositionGlobal: 0,
              queuePositionUser: 0,
            });
            this.updateTaskProgressWithTelemetry(
              task,
              Math.round((pollProgress / 100) * file.size),
              pollProgress,
            );
            nextPollMs = this.clampRecommendedMs(
              statusPayload.recommendedPollMs,
              1500,
              10000,
              2600,
            );
          } else {
            const pollProgress = Math.round(50 + (tgProgress || 0) * 0.5);
            this.updateTask(task.id, {
              status: "uploading",
              queuePositionGlobal: 0,
              queuePositionUser: 0,
            });
            this.updateTaskProgressWithTelemetry(
              task,
              Math.round((pollProgress / 100) * file.size),
              pollProgress,
            );
          }

          if (!settled) pollTimerId = setTimeout(poll, nextPollMs);
          return;
        } catch (e: any) {
          if (e.name === "CanceledError" || e.name === "AbortError") {
            settle(() => reject(new Error("Cancelled")));
            return;
          }
          if (e.response?.status === 404 || e.response?.status === 403) {
            settle(() =>
              reject(
                new Error(
                  e.response?.data?.error ||
                    `Upload fatal error ${e.response?.status}`,
                ),
              ),
            );
            return;
          }
          if (e.response?.data?.retryable === false) {
            settle(() =>
              reject(
                new Error(
                  e.response?.data?.error ||
                    e.response?.data?.message ||
                    "Upload failed",
                ),
              ),
            );
            return;
          }
        }

        if (!settled) pollTimerId = setTimeout(poll, 2600);
      };

      // Clean up poll timer on abort to prevent memory leaks
      abort.signal.addEventListener(
        "abort",
        () => {
          if (pollTimerId) {
            clearTimeout(pollTimerId);
            pollTimerId = null;
          }
          settle(() => reject(new Error("Cancelled")));
        },
        { once: true },
      );

      poll();
    });
  }

  // uploadViaSingleStream removed — chunk-only architecture

  // ── Background support ────────────────────────────────────────────────────

  public resumeAllBackground() {
    // Only resume work we paused for suspension. A user's pause is deliberate.
    for (const task of this.tasks) {
      if (task.status === 'paused' && task.pausedForBackground) this.resume(task.id);
    }
    this.scheduleQueuePump();
  }

  public ensureProcessing() {
    this.scheduleQueuePump();
  }
}

// Singleton shared across the entire app lifetime
export const uploadManager = new UploadManager();

export const handleUploadNotificationAction = (actionId: string) => {
  switch (String(actionId || "")) {
    case UPLOAD_NOTIFICATION_ACTION_PAUSE:
      uploadManager.pauseAll();
      return;
    case UPLOAD_NOTIFICATION_ACTION_RESUME:
      uploadManager.resumeAll();
      uploadManager.ensureProcessing();
      return;
    case UPLOAD_NOTIFICATION_ACTION_CANCEL:
      uploadManager.cancelAll();
      return;
    default:
      return;
  }
};
