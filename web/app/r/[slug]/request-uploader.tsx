"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { API_URL } from "../../../lib/urls";
import styles from "./request.module.css";
type Transfer = {
  key: string;
  file: File;
  uploadId?: string;
  status: string;
  progress: number;
  error?: string;
};
export default function RequestUploader({ slug }: { slug: string }) {
  const [key, setKey] = useState(""),
    [password, setPassword] = useState(""),
    [info, setInfo] = useState<any>(null),
    [error, setError] = useState(""),
    [rows, setRows] = useState<Transfer[]>([]),
    [busy, setBusy] = useState(false),
    [paused, setPaused] = useState(false);
  const pauseRef = useRef(false),
    mounted = useRef(true),
    controllers = useRef(new Set<AbortController>()),
    running = useRef(false),
    accessSession = useRef("");
  useEffect(() => {
    mounted.current = true;
    setKey(new URLSearchParams(location.hash.slice(1)).get("k") || "");
    return () => {
      mounted.current = false;
      controllers.current.forEach((c) => c.abort());
    };
  }, []);
  const api = useCallback(
    async (path: string, body?: any): Promise<any> => {
      const controller = new AbortController();
      controllers.current.add(controller);
      const timer = setTimeout(
        () => controller.abort(),
        path === "/chunk" ? 600000 : 60000,
      );
      try {
        const headers: Record<string, string> = { "X-Axya-Request-Key": key };
        if (accessSession.current)
          headers["X-Axya-Request-Session"] = accessSession.current;
        else if (password) headers["X-Axya-Request-Password"] = password;
        if (body && !(body instanceof FormData))
          headers["Content-Type"] = "application/json";
        const res = await fetch(
          `${API_URL}/file-requests/${encodeURIComponent(slug)}${path}`,
          {
            method: body ? "POST" : "GET",
            headers,
            body:
              body instanceof FormData
                ? body
                : body
                  ? JSON.stringify(body)
                  : undefined,
            signal: controller.signal,
          },
        );
        const data = await res.json();
        if (res.status === 401 && accessSession.current && password && path !== "/info") {
          accessSession.current = "";
          const refreshed = await api("/info");
          accessSession.current = refreshed.accessSession || "";
          return api(path, body);
        }
        if (!res.ok || data.success === false)
          throw Object.assign(
            new Error(data.message || data.error || "Upload failed."),
            { status: res.status, retryable: data.retryable },
          );
        return data;
      } finally {
        clearTimeout(timer);
        controllers.current.delete(controller);
      }
    },
    [slug, key, password],
  );
  const load = useCallback(async () => {
    setError("");
    try {
      const data = await api("/info");
      accessSession.current = data.accessSession || "";
      setInfo(data);
    } catch (e: any) {
      setError(e.message);
    }
  }, [api]);
  useEffect(() => {
    if (key) void load();
  }, [key]);
  const update = (row: Transfer, patch: Partial<Transfer>) => {
    Object.assign(row, patch);
    if (mounted.current)
      setRows((old) => old.map((r) => (r.key === row.key ? { ...row } : r)));
  };
  const run = async () => {
    if (running.current || !info) return;
    running.current = true;
    setBusy(true);
    pauseRef.current = false;
    setPaused(false);
    const pending = rows.filter((r) => r.status !== "Uploaded");
    let cursor = 0;
    const worker = async () => {
      while (cursor < pending.length && mounted.current && !pauseRef.current) {
        const row = pending[cursor++];
        let attempts = 0;
        while (mounted.current && !pauseRef.current) {
          try {
            if (!navigator.onLine) {
              update(row, { status: "Waiting for internet" });
              await new Promise((r) => setTimeout(r, 2000));
              continue;
            }
            update(row, { status: "Uploading", error: undefined });
            if (!row.uploadId) {
              const init = await api("/init", {
                originalname: row.file.name,
                size: row.file.size,
                mimetype: row.file.type || "application/octet-stream",
                client_upload_key: row.key,
              });
              row.uploadId = init.uploadId;
              localStorage.setItem(
                `axya-request:${slug}:${row.file.name}:${row.file.size}:${row.file.lastModified}`,
                JSON.stringify({ key: row.key, uploadId: row.uploadId }),
              );
            }
            let status = await api(`/status/${row.uploadId}`);
            if (status.status === "paused") {
              await api("/resume", { uploadId: row.uploadId });
              status = await api(`/status/${row.uploadId}`);
            }
            if (status.status === "queued")
              await api("/heartbeat", { uploadId: row.uploadId });
            if (status.status === "completed") {
              update(row, { status: "Uploaded", progress: 100 });
              break;
            }
            if (["error", "cancelled", "failed"].includes(status.status))
              throw Object.assign(
                new Error(
                  status.error ||
                    "Upload session ended. Remove and reselect the file.",
                ),
                { retryable: false },
              );
            if (!["processing", "queued"].includes(status.status)) {
              const received = new Set<number>(status.uploadedChunks || []);
              const chunkSize = Number(status.chunkSizeBytes) || 5 * 1024 ** 2;
              const total = Math.ceil(row.file.size / chunkSize);
              for (let i = 0; i < total; i++) {
                if (pauseRef.current) break;
                if (received.has(i)) continue;
                const form = new FormData();
                form.append("uploadId", row.uploadId!);
                form.append("chunkIndex", String(i));
                form.append(
                  "chunk",
                  row.file.slice(i * chunkSize, (i + 1) * chunkSize),
                  "chunk.bin",
                );
                await api("/chunk", form);
                received.add(i);
                update(row, {
                  progress: Math.round((received.size / total) * 50),
                });
              }
              if (pauseRef.current) break;
              await api("/complete", { uploadId: row.uploadId });
            }
            update(row, {
              status:
                status.status === "queued"
                  ? "Waiting for upload capacity"
                  : "Saving to Telegram",
              progress: Number(status.progress) || 50,
            });
            await new Promise((r) => setTimeout(r, 2000));
            attempts = 0;
          } catch (e: any) {
            if (pauseRef.current || !mounted.current) break;
            attempts++;
            if (
              e.retryable === false ||
              [400, 401, 403, 404, 409, 413].includes(e.status) ||
              attempts > 12
            ) {
              update(row, { status: "Failed", error: e.message });
              break;
            }
            update(row, {
              status: `Retrying (${attempts}/12)`,
              error: e.message,
            });
            await new Promise((r) =>
              setTimeout(r, Math.min(30000, 1000 * 2 ** attempts)),
            );
          }
        }
        if (pauseRef.current) update(row, { status: "Paused" });
      }
    };
    try {
      await Promise.all([worker(), worker()]);
    } finally {
      running.current = false;
      if (mounted.current) {
        setBusy(false);
        void load();
      }
    }
  };
  const pause = () => {
    pauseRef.current = true;
    setPaused(true);
    controllers.current.forEach((c) => c.abort());
    rows
      .filter((r) => r.uploadId && r.status !== "Uploaded")
      .forEach((r) => {
        void api("/pause", { uploadId: r.uploadId }).catch(() => {});
      });
  };
  const pick = (files: FileList | null) => {
    if (!files || busy) return;
    const added: Transfer[] = [];
    for (const file of Array.from(files)) {
      if (!file.size || file.size > info.maxFileBytes) {
        setError(
          `${file.name}: select a non-empty file within the size limit.`,
        );
        continue;
      }
      if (
        rows.some(
          (r) =>
            r.file.name === file.name &&
            r.file.size === file.size &&
            r.file.lastModified === file.lastModified,
        )
      )
        continue;
      let saved: any;
      try {
        saved = JSON.parse(
          localStorage.getItem(
            `axya-request:${slug}:${file.name}:${file.size}:${file.lastModified}`,
          ) || "null",
        );
      } catch {}
      added.push({
        key: saved?.key || crypto.randomUUID(),
        file,
        uploadId: saved?.uploadId,
        status: "Ready",
        progress: 0,
      });
    }
    setRows((old) => [...old, ...added]);
  };
  return (
    <main className={styles.page}>
      <section className={styles.card}>
        <div className={styles.brand}>Axya</div>
        <h1>{info?.title || "Send files securely"}</h1>
        <p>
          Your files go into the recipient’s chosen folder. This link gives no
          access to their drive.
        </p>
        {!key && (
          <p role="alert">
            Open the complete request link, including its private key.
          </p>
        )}
        {!info && key && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void load();
            }}
          >
            <label>
              Request password
              <input
                type="password"
                autoComplete="off"
                maxLength={128}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
            <button type="submit">Open file request</button>
          </form>
        )}
        {error && (
          <p role="alert" className={styles.error}>
            {error}
          </p>
        )}
        {info && (
          <>
            <div className={styles.limits}>
              {info.remainingFiles} files available ·{" "}
              {(info.remainingBytes / 1024 ** 2).toFixed(0)} MB remaining ·
              Expires {new Date(info.expiresAt).toLocaleDateString()}
            </div>
            <label className={styles.picker}>
              Choose files
              <input
                type="file"
                multiple
                disabled={busy}
                onChange={(e) => {
                  pick(e.target.files);
                  e.target.value = "";
                }}
              />
            </label>
            <p className={styles.note}>
              Up to {(info.maxFileBytes / 1024 ** 2).toFixed(0)} MB per file.
              Keep this tab open during upload. After reopening, reselect the
              same files to resume acknowledged chunks.
            </p>
            <div aria-live="polite">
              {rows.map((r) => (
                <article key={r.key} className={styles.transfer}>
                  <div>
                    <strong>{r.file.name}</strong>
                    <span>
                      {r.status} · {r.progress}%
                    </span>
                  </div>
                  <progress max={100} value={r.progress} />
                  {r.error && <p>{r.error}</p>}
                  {!busy && (
                    <button
                      className={styles.remove}
                      onClick={() => {
                        try {
                          localStorage.removeItem(
                            `axya-request:${slug}:${r.file.name}:${r.file.size}:${r.file.lastModified}`,
                          );
                        } catch {}
                        if (r.uploadId && r.status !== "Uploaded")
                          void api("/cancel", { uploadId: r.uploadId }).catch(
                            () => {},
                          );
                        setRows((old) => old.filter((x) => x.key !== r.key));
                      }}
                    >
                      Remove
                    </button>
                  )}
                </article>
              ))}
            </div>
            <div className={styles.actions}>
              {busy && !paused ? (
                <button onClick={pause}>Pause uploads</button>
              ) : (
                <button
                  disabled={busy || !rows.some((r) => r.status !== "Uploaded")}
                  onClick={() => void run()}
                >
                  {paused ? "Resume uploads" : "Upload files"}
                </button>
              )}
              <span>
                {busy
                  ? "Transfers remain active in this tab"
                  : "Files are saved after Telegram confirms completion"}
              </span>
            </div>
          </>
        )}
      </section>
    </main>
  );
}
