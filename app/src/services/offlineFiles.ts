import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";
import { Directory, File, Paths } from "expo-file-system";
import apiClient from "./apiClient";
import { API_URL } from "../config/urls";
import { buildApiFileUrl } from "../utils/fileSafety";
import { nativeTransfer } from "./nativeTransfer";

export type OfflineFile = {
  id: string;
  name: string;
  mime_type: string;
  size: number;
  created_at: string;
  savedAt: number;
  sha256?: string;
  uri?: string;
};
const listeners = new Set<() => void>();
const saving = new Map<string, Promise<void>>();
const key = (owner: string) => `@offline_files:${owner}`;
const safe = (id: string) => {
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(id))
    throw new Error("Invalid file identity");
  return id;
};
const directory = (owner: string) =>
  new Directory(Paths.document, "offline-files", safe(owner));
let webDb: Promise<IDBDatabase> | undefined;
function database() {
  return (webDb ||= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("axya-offline-files", 1);
    let settled = false;
    const fail = () => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(
          new Error(
            "Offline storage is unavailable. Close other Axya tabs and check free space.",
          ),
        );
      }
    };
    const timer = setTimeout(fail, 15000);
    request.onupgradeneeded = () => request.result.createObjectStore("files");
    request.onsuccess = () => {
      if (settled) {
        request.result.close();
        return;
      }
      settled = true;
      clearTimeout(timer);
      request.result.onversionchange = () => {
        request.result.close();
        webDb = undefined;
      };
      resolve(request.result);
    };
    request.onerror = request.onblocked = fail;
  }).catch((error) => {
    webDb = undefined;
    throw error;
  }));
}
async function blobOperation(
  owner: string,
  id: string,
  action: "get" | "put" | "delete",
  blob?: Blob,
): Promise<Blob | undefined> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(
      "files",
      action === "get" ? "readonly" : "readwrite",
    );
    const store = tx.objectStore("files");
    const taskKey = `${owner}:${id}`;
    const r =
      action === "get"
        ? store.get(taskKey)
        : action === "put"
          ? store.put(blob, taskKey)
          : store.delete(taskKey);
    tx.oncomplete = () => resolve(action === "get" ? r.result : undefined);
    tx.onerror = tx.onabort = () =>
      reject(new Error("Could not write offline storage. Check free space."));
  });
}
let indexWrites = Promise.resolve();
function editIndex(
  owner: string,
  edit: (rows: OfflineFile[]) => OfflineFile[],
) {
  const job = indexWrites
    .catch(() => {})
    .then(async () => {
      const rows = await listOfflineFiles(owner);
      await AsyncStorage.setItem(key(owner), JSON.stringify(edit(rows)));
      listeners.forEach((listener) => listener());
    });
  indexWrites = job;
  return job;
}
export function subscribeOffline(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
export async function listOfflineFiles(owner: string): Promise<OfflineFile[]> {
  if (!owner) return [];
  return JSON.parse((await AsyncStorage.getItem(key(owner))) || "[]");
}
export function saveOfflineFile(
  owner: string,
  fileId: string,
  token: string,
): Promise<void> {
  safe(owner);
  safe(fileId);
  if (!token)
    return Promise.reject(new Error("Sign in to save a file offline."));
  const taskKey = `${owner}:${fileId}`;
  const existing = saving.get(taskKey);
  if (existing) return existing;
  const job = (async () => {
    const { data } = await apiClient.get(`/files/${fileId}/details`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const file = data.file;
    if (!file || file.is_trashed) throw new Error("This file is unavailable.");
    const expectedSize = Number(file.size);
    if (!Number.isSafeInteger(expectedSize) || expectedSize <= 0)
      throw new Error("Invalid file size.");
    const url = buildApiFileUrl(API_URL, fileId, "download");
    let uri: string | undefined;
    let actualHash: string | undefined;
    if (Platform.OS === "web") {
      if (expectedSize > 256 * 1024 ** 2)
        throw new Error(
          "Use the Android app for offline copies larger than 256 MB.",
        );
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(600000),
      });
      if (!response.ok) throw new Error("Could not save this file offline.");
      const blob = await response.blob();
      if (blob.size !== expectedSize)
        throw new Error("Incomplete download. Retry this file.");
      if (blob.size <= 64 * 1024 * 1024 && file.sha256_hash) {
        const hash = await crypto.subtle.digest(
          "SHA-256",
          await blob.arrayBuffer(),
        );
        actualHash = Array.from(new Uint8Array(hash))
          .map((n) => n.toString(16).padStart(2, "0"))
          .join("");
        if (actualHash !== file.sha256_hash)
          throw new Error("Download integrity check failed.");
      }
      await blobOperation(owner, fileId, "put", blob);
    } else {
      const folder = directory(owner);
      folder.create({ intermediates: true, idempotent: true });
      const part = new File(folder, `${safe(fileId)}.partial`);
      const final = new File(folder, safe(fileId));
      try {
        const downloaded = await File.downloadFileAsync(url, part, {
          headers: { Authorization: `Bearer ${token}` },
          idempotent: true,
        });
        if (downloaded.size !== expectedSize)
          throw new Error("Incomplete download. Retry this file.");
        if (nativeTransfer && file.sha256_hash) {
          actualHash = await nativeTransfer.sha256(downloaded.uri);
          if (actualHash !== file.sha256_hash)
            throw new Error("Download integrity check failed.");
        }
        if (final.exists) final.delete();
        downloaded.move(final);
        uri = final.uri;
      } catch (error) {
        if (part.exists) part.delete();
        throw error;
      }
    }
    const saved: OfflineFile = {
      id: fileId,
      name: file.name,
      mime_type: file.mime_type,
      size: expectedSize,
      created_at: file.created_at,
      savedAt: Date.now(),
      sha256: file.sha256_hash,
      uri,
    };
    await editIndex(owner, (rows) => [
      saved,
      ...rows.filter((f) => f.id !== fileId),
    ]);
  })().finally(() => saving.delete(taskKey));
  saving.set(taskKey, job);
  return job;
}
export async function openOfflineFile(
  owner: string,
  id: string,
): Promise<{ uri: string; release: () => void } | null> {
  const row = (await listOfflineFiles(owner)).find((f) => f.id === id);
  if (!row) return null;
  if (Platform.OS === "web") {
    const blob = await blobOperation(owner, id, "get");
    if (!blob) return null;
    const uri = URL.createObjectURL(blob);
    return { uri, release: () => URL.revokeObjectURL(uri) };
  }
  const file = new File(directory(owner), safe(id));
  if (!file.exists || file.size !== row.size) return null;
  return { uri: file.uri, release: () => {} };
}
export async function removeOfflineFile(owner: string, id: string) {
  if (Platform.OS === "web") await blobOperation(owner, id, "delete");
  else {
    const file = new File(directory(owner), safe(id));
    if (file.exists) file.delete();
  }
  await editIndex(owner, (rows) => rows.filter((f) => f.id !== id));
}
