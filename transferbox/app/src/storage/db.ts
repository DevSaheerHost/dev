/**
 * IndexedDB: local cache and offline queue.
 *
 * Three stores:
 *   items     — the last known state of a workspace, so history survives a
 *               reload and stays readable while offline
 *   pending   — transfers captured while offline, with their Blob intact
 *   settings  — workspace references, theme, retention preference
 *
 * Large payloads (text bodies and file Blobs) live here rather than in
 * localStorage, which is synchronous, string-only and far too small.
 */

import type { Item, PendingTransfer, StoredWorkspace } from '@/types';

const DB_NAME = 'transferbox';
const DB_VERSION = 1;

const STORE_ITEMS = 'items';
const STORE_PENDING = 'pending';
const STORE_SETTINGS = 'settings';

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDatabase(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);

  return new Promise((resolve) => {
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      resolve(null);
      return;
    }

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_ITEMS)) {
        const store = db.createObjectStore(STORE_ITEMS, { keyPath: 'key' });
        store.createIndex('workspaceId', 'workspaceId', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_PENDING)) {
        db.createObjectStore(STORE_PENDING, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_SETTINGS)) {
        db.createObjectStore(STORE_SETTINGS, { keyPath: 'key' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
}

function database(): Promise<IDBDatabase | null> {
  dbPromise ??= openDatabase();
  return dbPromise;
}

async function withStore<T>(
  name: string,
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T | null> {
  const db = await database();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(name, mode);
      const request = run(tx.objectStore(name));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

/* --------------------------------------------------------------- items ---- */

interface CachedItem {
  key: string;
  workspaceId: string;
  item: Item;
}

const itemKey = (workspaceId: string, itemId: string) => `${workspaceId}:${itemId}`;

export async function cacheItems(workspaceId: string, items: Item[]): Promise<void> {
  const db = await database();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE_ITEMS, 'readwrite');
      const store = tx.objectStore(STORE_ITEMS);
      const index = store.index('workspaceId');
      const cursorRequest = index.openCursor(IDBKeyRange.only(workspaceId));
      cursorRequest.onsuccess = () => {
        const cursor = cursorRequest.result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
          return;
        }
        for (const item of items) {
          const record: CachedItem = { key: itemKey(workspaceId, item.id), workspaceId, item };
          store.put(record);
        }
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
}

export async function readCachedItems(workspaceId: string): Promise<Item[]> {
  const db = await database();
  if (!db) return [];
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_ITEMS, 'readonly');
      const index = tx.objectStore(STORE_ITEMS).index('workspaceId');
      const request = index.getAll(IDBKeyRange.only(workspaceId));
      request.onsuccess = () => resolve((request.result as CachedItem[]).map((row) => row.item));
      request.onerror = () => resolve([]);
    } catch {
      resolve([]);
    }
  });
}

/* ------------------------------------------------------------- pending ---- */

export async function queuePending(transfer: PendingTransfer): Promise<void> {
  await withStore(STORE_PENDING, 'readwrite', (store) => store.put(transfer));
}

export async function readPending(): Promise<PendingTransfer[]> {
  const rows = await withStore<PendingTransfer[]>(STORE_PENDING, 'readonly', (store) => store.getAll());
  return rows ?? [];
}

export async function removePending(id: string): Promise<void> {
  await withStore(STORE_PENDING, 'readwrite', (store) => store.delete(id));
}

/* ------------------------------------------------------------ settings ---- */

interface SettingRow<T> {
  key: string;
  value: T;
}

export async function readSetting<T>(key: string, fallback: T): Promise<T> {
  const row = await withStore<SettingRow<T> | undefined>(STORE_SETTINGS, 'readonly', (store) =>
    store.get(key),
  );
  return row?.value ?? fallback;
}

export async function writeSetting<T>(key: string, value: T): Promise<void> {
  await withStore(STORE_SETTINGS, 'readwrite', (store) => store.put({ key, value }));
}

export async function deleteSetting(key: string): Promise<void> {
  await withStore(STORE_SETTINGS, 'readwrite', (store) => store.delete(key));
}

export const SETTING_KEYS = {
  workspaces: 'workspaces',
  activeWorkspace: 'active-workspace',
  retention: 'retention',
  theme: 'theme',
} as const;

export async function readWorkspaces(): Promise<StoredWorkspace[]> {
  return readSetting<StoredWorkspace[]>(SETTING_KEYS.workspaces, []);
}

export async function writeWorkspaces(list: StoredWorkspace[]): Promise<void> {
  await writeSetting(SETTING_KEYS.workspaces, list);
}
