import type { UploadTask } from './types';

const openStore = (): Promise<IDBDatabase> => new Promise((resolve, reject) => {
  const request = indexedDB.open('axya-transfers', 1);
  request.onupgradeneeded = () => request.result.createObjectStore('queues');
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

export async function readTransfers(owner: string): Promise<UploadTask[]> {
  const database = await openStore();
  try {
    return await new Promise((resolve, reject) => {
      const request = database.transaction('queues').objectStore('queues').get(owner);
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  } finally { database.close(); }
}

export async function saveTransfers(owner: string, tasks: UploadTask[]): Promise<void> {
  const database = await openStore();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction('queues', 'readwrite');
      transaction.objectStore('queues').put(tasks.filter(task => !['completed', 'cancelled'].includes(task.status)).map(task => ({ ...task, previewUrl: undefined })), owner);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error || new Error('Transfer storage was interrupted'));
    });
  } finally { database.close(); }
}
