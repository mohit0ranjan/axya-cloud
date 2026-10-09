/**
 * DownloadManager.ts — Centralized download queue manager
 *
 * ✅ Track all active download tasks with progress
 * ✅ Cancel individual or all downloads via AbortController
 * ✅ expo-file-system SDK 55 File.downloadFileAsync with headers
 * ✅ Notifications for download progress (Android)
 * ✅ Subscriber pattern (same as UploadManager) for React integration
 */

import { File, Paths } from "expo-file-system";
import * as LegacyFileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { API_BASE } from "./apiClient";
import { buildApiFileUrl } from "../utils/fileSafety";
import { getNotificationsEnabled } from "../utils/preferences";
import { exportDownloadedFile } from "./exportDownloadedFile";

// ─── Types ────────────────────────────────────────────────────────────────────

export type DownloadStatus =
  | "queued"
  | "downloading"
  | "completed"
  | "failed"
  | "cancelled";

export interface DownloadTask {
  id: string;
  fileId: string;
  fileName: string;
  mimeType?: string;
  /** 0-100 */
  progress: number;
  status: DownloadStatus;
  error?: string;
  /** The local file path once downloaded */
  localPath?: string;
  /** Browser owns transfer progress and cancellation after the handoff. */
  browserHandoff?: boolean;
}

// ─── DownloadManager ─────────────────────────────────────────────────────────

class DownloadManager {
  public tasks: DownloadTask[] = [];

  private readonly MAX_CONCURRENT = 3;
  private readonly notificationsEnabled =
    Platform.OS !== "web" &&
    typeof Notifications.scheduleNotificationAsync === "function";
  private activeDownloads = 0;
  private lastNotificationAt = 0;
  private lastNotificationState = "";
  private ownerId: string | null = null;
  private credentials = new Map<string, string>();
  private webControllers = new Map<string, AbortController>();
  private listeners: ((tasks: DownloadTask[]) => void)[] = [];

  /**
   * Map of taskId → DownloadResumable.
   * Allows true transport-level cancellation via cancelAsync().
   */
  private downloadWorkers: Map<string, LegacyFileSystem.DownloadResumable> =
    new Map();

  // ── Subscription ─────────────────────────────────────────────────────────

  public subscribe(listener: (tasks: DownloadTask[]) => void): () => void {
    this.listeners.push(listener);
    listener(this.snapshotTasks());
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  /**
   * Creates a new array with new task objects on every call.
   * React state comparison (===) needs new references
   * to detect changes inside task objects (e.g. progress, status).
   */
  private snapshotTasks(): DownloadTask[] {
    return this.tasks.map((t) => ({ ...t }));
  }

  private notifyListeners() {
    this.updateNotification();
    const snapshot = this.snapshotTasks();
    this.listeners.forEach((l) => l(snapshot));
  }

  // ── Notifications ────────────────────────────────────────────────────────

  private async updateNotification() {
    if (!this.notificationsEnabled || !(await getNotificationsEnabled()))
      return;
    const active = this.tasks.filter(
      (t) => t.status === "downloading" || t.status === "queued",
    );

    const state = this.tasks.map(t => `${t.id}:${t.status}`).join("|");
    const now = Date.now();
    if (state === this.lastNotificationState && now - this.lastNotificationAt < 5000) return;
    if (!active.length && state === this.lastNotificationState) return;
    this.lastNotificationAt = now;
    this.lastNotificationState = state;
    if (active.length > 0) {
      // Simple average progress for downloads (no weighted by size since we don't always know size)
      const avgProgressRaw =
        active.reduce(
          (acc, t) => acc + (Number.isFinite(t.progress) ? t.progress : 0),
          0,
        ) / active.length;
      const avgProgress = Math.max(
        0,
        Math.min(
          100,
          Number.isFinite(avgProgressRaw) ? Math.round(avgProgressRaw) : 0,
        ),
      );

      try {
        await Notifications.scheduleNotificationAsync({
          identifier: "download_progress",
          content: {
            title: `Downloading · ${avgProgress}%`,
            body: `${active.length} file${active.length > 1 ? "s" : ""} in progress…`,
            data: { type: "download_progress", progress: avgProgress },
            sticky: true,
            autoDismiss: false,
            color: "#4B6EF5",
            priority: Notifications.AndroidNotificationPriority.LOW,
          },
          trigger: { channelId: "upload_channel" },
        });
      } catch {
        /* non-critical */
      }
    } else {
      try {
        await Notifications.dismissNotificationAsync("download_progress");

        const completed = this.tasks.filter(
          (t) => t.status === "completed",
        ).length;
        const failed = this.tasks.filter((t) => t.status === "failed").length;
        if (completed > 0 || failed > 0) {
          await Notifications.scheduleNotificationAsync({
            identifier: "download_result",
            content: {
              title:
                failed > 0 ? "Downloads finished ⚠️" : "Downloads complete ✅",
              body:
                failed > 0
                  ? `${completed} done · ${failed} failed`
                  : `${completed} file${completed > 1 ? "s" : ""} downloaded`,
              color: failed > 0 ? "#EF4444" : "#1FD45A",
              priority: Notifications.AndroidNotificationPriority.DEFAULT,
            },
            trigger: { channelId: "upload_channel" },
          });
        }
      } catch {
        /* non-critical */
      }
    }
  }

  // ── Public API ────────────────────────────────────────────────────────────

  /**
   * Queue a file download.
   * @param fileId     Server file ID
   * @param fileName   Display / save name
   * @param jwt        Auth token
   * @param mimeType   Optional MIME type for sharing
   * @returns          The created task ID
   */
  public addDownload(
    fileId: string,
    fileName: string,
    jwt: string,
    mimeType?: string,
  ): string {
    const taskId = `dl_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

    const task: DownloadTask = {
      id: taskId,
      fileId,
      fileName,
      mimeType,
      progress: 0,
      status: "queued",
    };

    this.tasks.push(task);
    this.credentials.set(taskId, jwt);
    this.notifyListeners();
    this.processQueue();
    return taskId;
  }

  /**
   * Cancel a single download.
   */
  public cancel(id: string) {
    const task = this.tasks.find((t) => t.id === id);
    if (!task) return;
    if (["queued", "downloading"].includes(task.status)) {
      task.status = "cancelled";
      task.progress = 0;
      this.webControllers.get(id)?.abort();
      const worker = this.downloadWorkers.get(id);
      if (worker) {
        worker.cancelAsync().catch(() => {});
      }
      this.notifyListeners();
    }
  }

  /**
   * Cancel ALL active/queued downloads.
   */
  public cancelAll() {
    let changed = false;
    this.tasks.forEach((task) => {
      if (task.status === "queued" || task.status === "downloading") {
        task.status = "cancelled";
        task.progress = 0;
        this.webControllers.get(task.id)?.abort();
        const worker = this.downloadWorkers.get(task.id);
        if (worker) {
          worker.cancelAsync().catch(() => {});
        }
        changed = true;
      }
    });
    if (changed) {
      this.notifyListeners();
    }
  }

  /**
   * Remove completed/cancelled/failed tasks from the list.
   */
  public clearCompleted() {
    this.tasks = this.tasks.filter(
      (t) =>
        t.status !== "completed" &&
        t.status !== "cancelled" &&
        t.status !== "failed",
    );
    this.notifyListeners();
  }

  /**
   * Check if any downloads are active.
   */
  public get hasActive(): boolean {
    return this.tasks.some(
      (t) => t.status === "downloading" || t.status === "queued",
    );
  }

  public bindOwner(ownerId: string | null) {
    if (this.ownerId === ownerId) return;
    this.cancelAll();
    this.tasks = [];
    this.credentials.clear();
    this.ownerId = ownerId;
    this.notifyListeners();
  }

  // ── Queue Processor ──────────────────────────────────────────────────────

  private async processQueue(): Promise<void> {
    if (this.activeDownloads >= this.MAX_CONCURRENT) return;

    const nextTask = this.tasks.find((t) => t.status === "queued");
    if (!nextTask) return;

    this.activeDownloads++;
    nextTask.status = "downloading";
    this.notifyListeners();

    try {
      await this.performDownload(nextTask, this.credentials.get(nextTask.id) || "");
      if ((nextTask.status as DownloadStatus) !== "cancelled") {
        nextTask.status = "completed";
        nextTask.progress = 100;
      }
    } catch (e: any) {
      const isCancelError =
        e?.name === "AbortError" || e?.message === "Cancelled";

      if (
        isCancelError ||
        (nextTask.status as DownloadStatus) === "cancelled"
      ) {
        nextTask.status = "cancelled";
        nextTask.progress = 0;
      } else {
        nextTask.status = "failed";
        nextTask.progress = 0;
        nextTask.error = e?.message || "Download failed";
      }
    } finally {
      this.downloadWorkers.delete(nextTask.id);
      this.webControllers.delete(nextTask.id);
      this.credentials.delete(nextTask.id);
      this.activeDownloads = Math.max(0, this.activeDownloads - 1);
      this.notifyListeners();
      this.processQueue();
    }
  }

  // ── Core Download Logic ──────────────────────────────────────────────────

  private sanitizeFileName(name: string): string {
    const trimmed = String(name || "").trim();
    const base = trimmed || "download";
    const cleaned = base
      .replace(/[\/\\:*?"<>|\r\n]+/g, "_")
      .replace(/\s+/g, " ")
      .trim();
    return cleaned || "download";
  }

  private buildHttpErrorMessage(status: number, responseBody?: string): string {
    const parsed = responseBody?.trim();
    let code = "";
    let backendError = "";
    if (parsed) {
      try {
        const json = JSON.parse(parsed);
        code = String(json?.code || "").toLowerCase();
        backendError = String(json?.message || json?.error || "").trim();
      } catch {
        // keep defaults
      }
    }

    if (code === "schema_not_ready")
      return "Service is starting. Please retry in a moment.";
    if (code === "telegram_session_expired")
      return "Telegram session expired. Please reconnect Telegram.";
    if (code === "telegram_message_not_found")
      return "File no longer exists in Telegram.";
    if (code === "telegram_chat_invalid")
      return "File source mapping is invalid. Re-upload may be required.";
    if (backendError) return backendError;

    if (status === 401) return "Unauthorized. Please sign in again.";
    if (status === 403) return "You do not have access to this file.";
    if (status === 404) return "File not found.";
    if (status === 409)
      return "File metadata is invalid. Please re-upload the file.";
    if (status === 502) return "Telegram file fetch failed. Try again.";
    if (status === 503)
      return "Telegram session unavailable. Please reconnect Telegram.";
    return `Download failed (${status})`;
  }

  private async performDownload(
    task: DownloadTask,
    jwt: string,
  ): Promise<void> {
    const throwIfCancelled = () => {
      if (task.status === "cancelled") {
        throw new Error("Cancelled");
      }
    };

    throwIfCancelled();

    const downloadUrl = buildApiFileUrl(API_BASE, task.fileId, "download");
    const safeFileName = this.sanitizeFileName(task.fileName);
    if (Platform.OS === "web") {
      await this.handoffBrowserDownload(task, downloadUrl, safeFileName, jwt);
      return;
    }
    const destFile = new File(Paths.document, `${task.id}-${safeFileName}`);

    task.progress = 5; // Starting
    this.notifyListeners();

    const worker = LegacyFileSystem.createDownloadResumable(
      downloadUrl,
      destFile.uri,
      { headers: { Authorization: `Bearer ${jwt}` } },
      (progressData) => {
        if (task.status === "cancelled") return;
        const total = progressData.totalBytesExpectedToWrite || 0;
        const written = progressData.totalBytesWritten || 0;
        if (total > 0) {
          // Keep room for post-download processing (share/save).
          const ratio = total > 0 ? written / total : 0;
          task.progress = Math.max(
            5,
            Math.min(90, Math.round(Math.max(0, ratio) * 90)),
          );
          this.notifyListeners();
        }
      },
    );
    this.downloadWorkers.set(task.id, worker);
    const result = await worker.downloadAsync();
    if (!result?.uri) throw new Error("Download failed");
    if ((result.status ?? 0) < 200 || (result.status ?? 0) >= 300) {
      let body = "";
      try {
        body = await LegacyFileSystem.readAsStringAsync(result.uri);
      } catch {
        // non-fatal, fallback to status code only
      }
      const message = this.buildHttpErrorMessage(result.status || 0, body);
      try {
        await LegacyFileSystem.deleteAsync(result.uri, { idempotent: true });
      } catch {
        // cleanup failure is non-critical
      }
      throw new Error(message);
    }

    throwIfCancelled();

    task.progress = 90;
    task.localPath = result.uri;
    this.notifyListeners();

    // ── Device Download Logic ──
    if (Platform.OS === "android") {
      try {
        const permissions =
          await LegacyFileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();
        throwIfCancelled();
        if (permissions.granted) {
          task.progress = 95;
          this.notifyListeners();
          const destUri =
            await LegacyFileSystem.StorageAccessFramework.createFileAsync(
              permissions.directoryUri,
              safeFileName,
              task.mimeType || "application/octet-stream",
            );
          await exportDownloadedFile(result.uri, destUri, throwIfCancelled, fraction => {
            task.progress = 95 + Math.floor(fraction * 4);
            this.notifyListeners();
          });
          task.localPath = destUri;

          task.progress = 100;
          this.notifyListeners();
          return;
        }
        throw new Error("Choose a destination folder to save this file.");
      } catch (safErr) {
        throwIfCancelled();
        throw safErr;
      }
    }

    // Fallback to Share for iOS or if Android SAF fails/user cancels
    if (await Sharing.isAvailableAsync()) {
      throwIfCancelled();
      task.progress = 95;
      this.notifyListeners();
      await Sharing.shareAsync(result.uri, { mimeType: task.mimeType });
    }

    task.progress = 100;
    this.notifyListeners();
  }

  private async handoffBrowserDownload(task: DownloadTask, url: string, name: string, jwt: string) {
    const controller = new AbortController();
    this.webControllers.set(task.id, controller);
    const timeout = setTimeout(() => controller.abort(), 60_000);
    try {
      // Small files use an authenticated response. The old cookie-only anchor
      // could silently download a 401 JSON response and report success.
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${jwt}` }, signal: controller.signal,
      });
      if (!response.ok) throw new Error(this.buildHttpErrorMessage(response.status, await response.text()));
      const size = Number(response.headers.get("content-length") || 0);
      if (size > 0 && size <= 64 * 1024 * 1024) {
        const chunks: ArrayBuffer[] = [];
        const reader = response.body?.getReader();
        let received = 0;
        if (reader) {
          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              if (task.status === "cancelled" || controller.signal.aborted) throw new Error("Cancelled");
              const copy = new Uint8Array(value.byteLength);
              copy.set(value);
              chunks.push(copy.buffer as ArrayBuffer);
              received += value.byteLength;
              task.progress = Math.min(95, Math.round(received / size * 95));
              this.notifyListeners();
            }
          } finally { reader.releaseLock(); }
        }
        const blob = reader ? new Blob(chunks, { type: task.mimeType || "application/octet-stream" }) : await response.blob();
        if (task.status === "cancelled" || controller.signal.aborted) throw new Error("Cancelled");
        if (blob.size !== size) throw new Error("Download ended before the full file arrived.");
        const objectUrl = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = objectUrl;
        anchor.download = name;
        document.body.appendChild(anchor);
        try { anchor.click(); } finally { anchor.remove(); window.setTimeout(() => URL.revokeObjectURL(objectUrl), 30_000); }
        task.browserHandoff = true;
        return;
      }
      await response.body?.cancel();
      const session = await fetch(`${API_BASE}/auth/browser-session`, {
        method: "POST", credentials: "include",
        headers: { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" },
        body: "{}", signal: controller.signal,
      });
      if (!session.ok) throw new Error(this.buildHttpErrorMessage(session.status, await session.text()));
      const cookieCheck = await fetch(url, {
        credentials: "include", headers: { Range: "bytes=0-0" }, signal: controller.signal,
      });
      if (!cookieCheck.ok) throw new Error(this.buildHttpErrorMessage(cookieCheck.status, await cookieCheck.text()));
      await cookieCheck.body?.cancel();
      if (task.status === "cancelled" || controller.signal.aborted) throw new Error("Cancelled");
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = name;
      document.body.appendChild(anchor);
      try { anchor.click(); } finally { anchor.remove(); }
      task.browserHandoff = true;
    } finally { clearTimeout(timeout); }
  }
}

// Singleton shared across the entire app lifetime
export const downloadManager = new DownloadManager();
