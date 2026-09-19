/**
 * Workspace item service — the only place that reads or writes workspace data.
 *
 * Responsibilities:
 *   - turn a composed text or a picked file into a stored item
 *   - stream binaries to Storage, never into the database
 *   - seal private-workspace content before it leaves the device
 *   - hide expired items and delete the ones it encounters
 */

import {
  onValue,
  ref,
  remove,
  set,
  query,
  orderByChild,
  limitToLast,
  type Unsubscribe,
} from 'firebase/database';
import {
  deleteObject,
  getBlob,
  ref as storageRef,
  uploadBytesResumable,
} from 'firebase/storage';

import { getDb, getFiles, isCloudConfigured } from '@/firebase/client';
import { itemPath, itemsPath, storageObjectPath } from '@/firebase/paths';
import {
  INLINE_TEXT_BYTES,
  MAX_FILE_BYTES,
  MAX_ITEMS_PER_WORKSPACE,
  MAX_TEXT_BYTES,
  PREVIEW_CHARS,
} from '@/lib/constants';
import { AppError, toAppError } from '@/lib/errors';
import {
  expiryFrom,
  isActiveContentType,
  isExpired,
  kindFromMime,
  sanitizeFileName,
} from '@/lib/format';
import {
  decryptBytes,
  decryptJson,
  deriveContentKey,
  encryptBytes,
  encryptJson,
  randomBytes,
  sha256Hex,
  toBase64Url,
} from '@/crypto/workspace';
import type { Item, ItemRecord, Progress, RetentionId, Workspace } from '@/types';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** Fields hidden behind encryption in a private workspace. */
interface SealedFields {
  preview: string;
  text?: string;
  fileName?: string;
  mimeType?: string;
}

const keyCache = new Map<string, Promise<CryptoKey>>();

function contentKey(workspace: Workspace): Promise<CryptoKey> | null {
  if (workspace.kind !== 'private') return null;
  let cached = keyCache.get(workspace.id);
  if (!cached) {
    cached = deriveContentKey(workspace.secret);
    keyCache.set(workspace.id, cached);
  }
  return cached;
}

export function newItemId(): string {
  return toBase64Url(randomBytes(12));
}

function requireDb() {
  const db = getDb();
  if (!db) throw new AppError('cloud-not-configured');
  return db;
}

function requireStorage() {
  const files = getFiles();
  if (!files) throw new AppError('cloud-not-configured');
  return files;
}

/* ------------------------------------------------------------- reading ---- */

/** Decrypt (when needed) and normalise a stored record for the interface. */
async function toItem(record: ItemRecord, workspace: Workspace): Promise<Item | null> {
  if (!record || typeof record.id !== 'string') return null;

  let fields: SealedFields = {
    preview: record.preview ?? '',
    ...(record.text === undefined ? {} : { text: record.text }),
    ...(record.fileName === undefined ? {} : { fileName: record.fileName }),
    ...(record.mimeType === undefined ? {} : { mimeType: record.mimeType }),
  };

  if (record.enc) {
    const key = contentKey(workspace);
    if (!key) return null;
    try {
      fields = await decryptJson<SealedFields>(await key, record.enc);
    } catch {
      // Written under a different secret — not ours to display.
      return null;
    }
  }

  return {
    id: record.id,
    type: record.type,
    size: Number(record.size) || 0,
    createdAt: Number(record.createdAt) || Date.now(),
    expiresAt: record.expiresAt === null ? null : Number(record.expiresAt) || null,
    preview: fields.preview ?? '',
    ...(fields.text === undefined ? {} : { text: fields.text }),
    ...(fields.fileName === undefined ? {} : { fileName: fields.fileName }),
    ...(fields.mimeType === undefined ? {} : { mimeType: fields.mimeType }),
    ...(record.storagePath === undefined ? {} : { storagePath: record.storagePath }),
    ...(record.sha256 === undefined ? {} : { sha256: record.sha256 }),
    remote: Boolean(record.storagePath),
    syncState: 'synced',
  };
}

export interface Subscription {
  close: Unsubscribe;
}

/**
 * Live view of a workspace. Expired records are filtered out for display and
 * swept from the backend opportunistically, so any active browser cleans up
 * after the ones that closed.
 */
export function subscribeItems(
  workspace: Workspace,
  onItems: (items: Item[]) => void,
  onError: (error: AppError) => void,
): Subscription {
  if (!isCloudConfigured()) {
    onError(new AppError('cloud-not-configured'));
    return { close: () => {} };
  }

  const db = requireDb();
  const listRef = query(
    ref(db, itemsPath(workspace)),
    orderByChild('createdAt'),
    limitToLast(MAX_ITEMS_PER_WORKSPACE),
  );

  const unsubscribe = onValue(
    listRef,
    (snapshot) => {
      const records: ItemRecord[] = [];
      snapshot.forEach((child) => {
        const value = child.val() as ItemRecord | null;
        if (value) records.push({ ...value, id: value.id ?? child.key! });
      });

      const now = Date.now();
      const live = records.filter((record) => !isExpired(record.expiresAt ?? null, now));
      const dead = records.filter((record) => isExpired(record.expiresAt ?? null, now));
      void sweep(workspace, dead);

      void Promise.all(live.map((record) => toItem(record, workspace))).then((items) => {
        const visible = items.filter((item): item is Item => item !== null);
        visible.sort((a, b) => b.createdAt - a.createdAt);
        onItems(visible);
      });
    },
    (error) => onError(toAppError(error, 'cloud-unavailable')),
  );

  return { close: unsubscribe };
}

/** Best-effort removal of expired records and their objects. */
async function sweep(workspace: Workspace, expired: ItemRecord[]): Promise<void> {
  for (const record of expired) {
    try {
      await deleteItem(workspace, {
        id: record.id,
        ...(record.storagePath === undefined ? {} : { storagePath: record.storagePath }),
      });
    } catch {
      // A sweep is opportunistic: another browser may have won the race.
    }
  }
}

/* ------------------------------------------------------------- writing ---- */

async function writeRecord(workspace: Workspace, record: ItemRecord): Promise<void> {
  const db = requireDb();
  await set(ref(db, itemPath(workspace, record.id)), record);
}

/** Build the record, sealing content when the workspace is private. */
async function buildRecord(
  workspace: Workspace,
  base: Omit<ItemRecord, 'preview' | 'text' | 'fileName' | 'mimeType' | 'enc'>,
  fields: SealedFields,
): Promise<ItemRecord> {
  const key = contentKey(workspace);
  if (key) {
    return { ...base, enc: await encryptJson(await key, fields) };
  }
  return {
    ...base,
    preview: fields.preview,
    ...(fields.text === undefined ? {} : { text: fields.text }),
    ...(fields.fileName === undefined ? {} : { fileName: fields.fileName }),
    ...(fields.mimeType === undefined ? {} : { mimeType: fields.mimeType }),
  };
}

export interface SaveOptions {
  retention: RetentionId;
  onProgress?: (progress: Progress) => void;
}

/**
 * Save text. Small bodies live inline in the database record; anything larger
 * is uploaded as a Storage object and only a preview stays in the record, so
 * a history list never downloads megabytes it will not show.
 */
export async function saveText(
  workspace: Workspace,
  text: string,
  options: SaveOptions,
): Promise<Item> {
  const trimmed = text;
  if (!trimmed.trim()) throw new AppError('empty');

  const bytes = encoder.encode(trimmed);
  if (bytes.byteLength > MAX_TEXT_BYTES) throw new AppError('text-too-large');

  const id = newItemId();
  const createdAt = Date.now();
  const expiresAt = expiryFrom(options.retention, createdAt);
  const preview = trimmed.slice(0, PREVIEW_CHARS);
  const digest = await sha256Hex(bytes as BufferSource);
  const inline = bytes.byteLength <= INLINE_TEXT_BYTES;

  let storagePath: string | undefined;
  if (!inline) {
    storagePath = await uploadBytes(workspace, id, 'text.txt', bytes, 'text/plain', options.onProgress);
  }

  const record = await buildRecord(
    workspace,
    {
      id,
      type: 'text',
      size: bytes.byteLength,
      createdAt,
      expiresAt,
      sha256: digest,
      ...(storagePath === undefined ? {} : { storagePath }),
    },
    { preview, ...(inline ? { text: trimmed } : {}) },
  );

  await writeRecord(workspace, record);

  return {
    id,
    type: 'text',
    size: bytes.byteLength,
    createdAt,
    expiresAt,
    preview,
    ...(inline ? { text: trimmed } : {}),
    ...(storagePath === undefined ? {} : { storagePath }),
    sha256: digest,
    remote: !inline,
    syncState: 'synced',
  };
}

/** Upload raw bytes or a Blob, sealing them first in a private workspace. */
async function uploadBytes(
  workspace: Workspace,
  itemId: string,
  safeName: string,
  data: Uint8Array | Blob,
  mimeType: string,
  onProgress?: (progress: Progress) => void,
): Promise<string> {
  const files = requireStorage();
  const key = contentKey(workspace);

  let body: Blob;
  if (key) {
    const raw = data instanceof Blob ? new Uint8Array(await data.arrayBuffer()) : data;
    const sealed = await encryptBytes(await key, raw as BufferSource);
    // Sealed bytes are opaque: the object type must not advertise the original.
    body = new Blob([sealed as BufferSource], { type: 'application/octet-stream' });
  } else {
    body = data instanceof Blob ? data : new Blob([data as BufferSource], { type: mimeType });
  }

  const path = storageObjectPath(workspace, itemId, safeName);
  const task = uploadBytesResumable(storageRef(files, path), body, {
    contentType: key ? 'application/octet-stream' : mimeType || 'application/octet-stream',
    cacheControl: 'private, max-age=3600',
  });

  await new Promise<void>((resolve, reject) => {
    task.on(
      'state_changed',
      (snapshot) =>
        onProgress?.({ loaded: snapshot.bytesTransferred, total: snapshot.totalBytes }),
      (error) => reject(toAppError(error, 'upload-failed')),
      () => resolve(),
    );
  });

  return path;
}

/**
 * Save a file exactly as it was given: no re-encoding, no compression, no
 * canvas round-trip. Only the storage path name is sanitised — the original
 * filename is preserved in metadata and restored on download.
 */
export async function saveFile(
  workspace: Workspace,
  file: File,
  options: SaveOptions,
): Promise<Item> {
  if (file.size === 0) throw new AppError('empty');
  if (file.size > MAX_FILE_BYTES) throw new AppError('file-too-large');
  if (isActiveContentType(file.type, file.name)) throw new AppError('unsafe-type');

  const id = newItemId();
  const createdAt = Date.now();
  const expiresAt = expiryFrom(options.retention, createdAt);
  const safeName = sanitizeFileName(file.name);
  const mimeType = file.type || 'application/octet-stream';
  const type = kindFromMime(mimeType, file.name);

  const buffer = new Uint8Array(await file.arrayBuffer());
  const digest = await sha256Hex(buffer as BufferSource);

  const storagePath = await uploadBytes(
    workspace,
    id,
    safeName,
    buffer,
    mimeType,
    options.onProgress,
  );

  const record = await buildRecord(
    workspace,
    { id, type, size: file.size, createdAt, expiresAt, sha256: digest, storagePath },
    { preview: file.name, fileName: file.name, mimeType },
  );

  await writeRecord(workspace, record);

  return {
    id,
    type,
    size: file.size,
    createdAt,
    expiresAt,
    preview: file.name,
    fileName: file.name,
    mimeType,
    storagePath,
    sha256: digest,
    remote: true,
    syncState: 'synced',
  };
}

/* ------------------------------------------------------------ fetching ---- */

/** Fetch an item's bytes, unsealing them for a private workspace. */
export async function fetchBlob(workspace: Workspace, item: Item): Promise<Blob> {
  if (!item.storagePath) throw new AppError('download-failed');
  const files = requireStorage();

  let blob: Blob;
  try {
    blob = await getBlob(storageRef(files, item.storagePath));
  } catch (error) {
    throw toAppError(error, 'download-failed');
  }

  const key = contentKey(workspace);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const plain = key ? await decryptBytes(await key, bytes) : bytes;

  if (item.sha256) {
    const digest = await sha256Hex(plain as BufferSource);
    if (digest !== item.sha256) throw new AppError('integrity-failed');
  }

  return new Blob([plain as BufferSource], { type: item.mimeType || 'application/octet-stream' });
}

/** Full text of an item, whether it was stored inline or as an object. */
export async function fetchText(workspace: Workspace, item: Item): Promise<string> {
  if (item.text !== undefined) return item.text;
  const blob = await fetchBlob(workspace, item);
  return decoder.decode(new Uint8Array(await blob.arrayBuffer()));
}

/* ------------------------------------------------------------ deleting ---- */

export async function deleteItem(
  workspace: Workspace,
  item: { id: string; storagePath?: string },
): Promise<void> {
  const db = requireDb();
  try {
    if (item.storagePath) {
      const files = getFiles();
      if (files) {
        await deleteObject(storageRef(files, item.storagePath)).catch(() => undefined);
      }
    }
    await remove(ref(db, itemPath(workspace, item.id)));
  } catch (error) {
    throw toAppError(error, 'delete-failed');
  }
}
