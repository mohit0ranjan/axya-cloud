import { Platform } from 'react-native';
import { Directory, File, Paths } from 'expo-file-system';

let sourceDb: Promise<IDBDatabase> | undefined;
function database(): Promise<IDBDatabase> {
    if (!sourceDb) sourceDb = new Promise<IDBDatabase>((resolve, reject) => {
        if (typeof indexedDB === 'undefined') { reject(new Error('This browser cannot save resumable uploads.')); return; }
        let settled = false;
        const fail = (error: Error) => { settled = true; clearTimeout(timer); reject(error); };
        const timer = setTimeout(() => fail(new Error('Upload storage is busy. Close other Axya tabs and retry.')), 15000);
        const request = indexedDB.open('axya-upload-sources', 1);
        request.onupgradeneeded = () => request.result.createObjectStore('sources');
        request.onsuccess = () => {
            if (settled) { request.result.close(); return; }
            clearTimeout(timer); settled = true;
            request.result.onversionchange = () => { request.result.close(); sourceDb = undefined; };
            resolve(request.result);
        };
        request.onblocked = () => fail(new Error('Close other Axya tabs to prepare this upload.'));
        request.onerror = () => fail(new Error('Could not open resumable upload storage.'));
    }).catch(error => { sourceDb = undefined; throw error; });
    return sourceDb;
}
async function sourceOperation(owner: string, task: string, action: 'get' | 'put' | 'delete', blob?: Blob): Promise<Blob | undefined> {
    const db = await database();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('sources', action === 'get' ? 'readonly' : 'readwrite');
        const store = tx.objectStore('sources'); const key = `${owner}:${task}`;
        const request = action === 'get' ? store.get(key) : action === 'put' ? store.put(blob, key) : store.delete(key);
        tx.oncomplete = () => resolve(action === 'get' ? request.result : undefined);
        tx.onerror = () => reject(new Error('Could not save the selected file on this device. Check available storage.'));
        tx.onabort = tx.onerror;
    });
}
// Bound disk/blob preparation independently of network workers for large selections.
let activePreparations = 0;
const preparationWaiters: Array<() => void> = [];
const preparing = new Map<string, Promise<{uri: string; size: number; blob?: Blob}>>();
export function retainUploadSource(owner: string, task: string, uri: string): Promise<{uri: string; size: number; blob?: Blob}> {
    const key = `${owner}:${task}`;
    const pending = preparing.get(key);
    if (pending) return pending;
    const job = (async () => {
        if (activePreparations >= 2) await new Promise<void>(resolve => preparationWaiters.push(resolve));
        else activePreparations++;
        try { return await prepareUploadSource(owner, task, uri); }
        finally {
            const next = preparationWaiters.shift();
            if (next) next(); else activePreparations--;
        }
    })().finally(() => preparing.delete(key));
    preparing.set(key, job);
    return job;
}
async function prepareUploadSource(owner: string, task: string, uri: string): Promise<{uri: string; size: number; blob?: Blob}> {
    if (!owner) throw new Error('Sign in before uploading files.');
    if (Platform.OS === 'web') {
        let blob = await sourceOperation(owner, task, 'get');
        if (!blob) {
            const response = await fetch(uri);
            if (!response.ok) throw new Error('The selected file is no longer available. Select it again.');
            blob = await response.blob(); await sourceOperation(owner, task, 'put', blob);
        }
        return {uri, size:blob.size, blob};
    }
    const directory = new Directory(Paths.document, 'upload-sources', owner);
    directory.create({intermediates:true,idempotent:true});
    const saved = new File(directory, `${task}.source`);
    if (!saved.exists) {
        const legacy = await import('expo-file-system/legacy');
        await legacy.copyAsync({from:uri,to:saved.uri});
    }
    return {uri:saved.uri,size:saved.size};
}
export async function discardUploadSource(owner: string, task: string) {
    if (!owner) return;
    if (Platform.OS === 'web') { await sourceOperation(owner, task, 'delete'); return; }
    const file = new File(new Directory(Paths.document, 'upload-sources', owner), `${task}.source`);
    if (file.exists) file.delete();
}
