/** Shared domain types. Everything crossing a layer boundary is typed here. */

export type ItemKind = 'text' | 'image' | 'video' | 'audio' | 'file';

/** How long an item survives. `null` means "keep until manually deleted". */
export type RetentionId = '1h' | '6h' | '24h' | '7d' | '30d' | 'forever';

export type WorkspaceKind = 'public' | 'private';

/** A workspace as held in memory. The secret never leaves the device. */
export interface PublicWorkspace {
  kind: 'public';
  id: 'public';
  label: string;
}

export interface PrivateWorkspace {
  kind: 'private';
  /** SHA-256 derived from the secret. Safe to send to the server. */
  id: string;
  /** High-entropy base64url secret. Never logged, never sent to the server. */
  secret: string;
  /** Human-friendly label, derived locally from the secret. */
  label: string;
}

export type Workspace = PublicWorkspace | PrivateWorkspace;

/** Persisted workspace reference (IndexedDB). */
export interface StoredWorkspace {
  id: string;
  kind: WorkspaceKind;
  secret?: string;
  label: string;
  lastUsedAt: number;
}

/**
 * The record written to the Realtime Database.
 *
 * Public workspaces store readable fields. Private workspaces store the same
 * fields inside `enc` (AES-GCM, key derived from the workspace secret) and
 * leave the readable ones empty, so the server never sees names or content.
 */
export interface ItemRecord {
  id: string;
  type: ItemKind;
  /** Bytes of the payload (text bytes, or file size). */
  size: number;
  createdAt: number;
  /** Epoch ms, or null for "keep until deleted". */
  expiresAt: number | null;
  /** Short plaintext preview for text items (public workspaces only). */
  preview?: string;
  /** Inline text body, only when small enough (public workspaces only). */
  text?: string;
  fileName?: string;
  mimeType?: string;
  /** Path inside Firebase Storage, for file items and large text bodies. */
  storagePath?: string;
  /** SHA-256 of the original bytes, hex. Used for integrity verification. */
  sha256?: string;
  /** Encrypted envelope (base64) for private workspaces. */
  enc?: string;
}

/** An item after decryption, ready for the UI. */
export interface Item {
  id: string;
  type: ItemKind;
  size: number;
  createdAt: number;
  expiresAt: number | null;
  preview: string;
  /** Present for small text items; large bodies live in Storage. */
  text?: string;
  fileName?: string;
  mimeType?: string;
  storagePath?: string;
  sha256?: string;
  /** True when the body must be fetched before it can be shown. */
  remote: boolean;
  /** Local-only items waiting to be uploaded. */
  pending?: boolean;
  syncState: SyncState;
}

export type SyncState = 'synced' | 'pending' | 'syncing' | 'failed' | 'local';

export type ConnectionState = 'online' | 'offline';

/** A transfer queued while offline. */
export interface PendingTransfer {
  id: string;
  workspaceId: string;
  createdAt: number;
  retention: RetentionId;
  kind: 'text' | 'file';
  text?: string;
  blob?: Blob;
  fileName?: string;
  mimeType?: string;
  attempts: number;
  lastError?: string;
}

export interface FilterState {
  query: string;
  type: 'all' | ItemKind;
  since: 'all' | '1h' | '24h' | '7d';
}

/** Progress reported by uploads, downloads and direct transfers. */
export interface Progress {
  loaded: number;
  total: number;
}
