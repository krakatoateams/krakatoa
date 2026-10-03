"use client";

/**
 * Browser copy of Video Editor device files, keyed `{userId}:{localMediaId}`, so a
 * saved project reopens with its media on the same browser without any upload.
 * Native IndexedDB; every call swallows errors (quota, private mode, no IDB).
 */

export type LocalMediaRecord = { blob: Blob; name: string; type: string; size: number };

const DB_NAME = "krakatoa-editor-media";
const STORE = "files";

export function localMediaKey(userId: string, localMediaId: string): string {
  return `${userId}:${localMediaId}`;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run<T>(mode: IDBTransactionMode, op: (store: IDBObjectStore) => IDBRequest): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = op(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req.result as T);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

/** False when the browser refused to store it; the caller keeps the File in memory. */
export async function putLocalMedia(key: string, file: File): Promise<boolean> {
  try {
    const record: LocalMediaRecord = { blob: file, name: file.name, type: file.type, size: file.size };
    await run("readwrite", (store) => store.put(record, key));
    return true;
  } catch {
    return false;
  }
}

export async function getLocalMedia(key: string): Promise<File | null> {
  try {
    const record = await run<LocalMediaRecord | undefined>("readonly", (store) => store.get(key));
    if (!record?.blob) return null;
    return new File([record.blob], record.name, { type: record.type });
  } catch {
    return null;
  }
}

export async function deleteLocalMedia(key: string): Promise<void> {
  try {
    await run("readwrite", (store) => store.delete(key));
  } catch {
    // Best-effort.
  }
}
