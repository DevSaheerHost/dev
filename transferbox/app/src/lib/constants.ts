/** Every tunable limit in one place — no magic numbers elsewhere. */

import type { RetentionId } from '@/types';

export const APP_NAME = 'TransferBox';

/**
 * Maximum size of a single upload. Raising this is a one-line change here plus
 * the matching limit in the Storage and Database rules; the transfer pipeline
 * is chunked and streams through Blobs, so nothing else has to change.
 */
export const MAX_FILE_BYTES = 3 * 1024 * 1024;

/** Largest text payload accepted in the composer. */
export const MAX_TEXT_BYTES = 3 * 1024 * 1024;

/**
 * Text below this size is stored inline in the database record. Anything
 * larger is uploaded as a Storage object so the database stays small and list
 * views never pull megabytes of body text.
 */
export const INLINE_TEXT_BYTES = 16 * 1024;

/** Characters kept for the list preview of a text item. */
export const PREVIEW_CHARS = 280;

/** Rendering more than this many characters at once is pointless and slow. */
export const FULL_VIEW_CHARS = 200_000;

export const MAX_ITEMS_PER_WORKSPACE = 200;

/** Raw bytes carried by a single QR frame, before base64 expansion. */
export const QR_CHUNK_BYTES = 480;

/** Default milliseconds between frames when auto-playing a QR sequence. */
export const QR_FRAME_INTERVAL_MS = 700;

/** Direct-transfer chunk size. Below the 64 KB SCTP comfort zone. */
export const RTC_CHUNK_BYTES = 16 * 1024;

/** Pause sending when the data channel has this much buffered. */
export const RTC_BUFFER_HIGH = 1 * 1024 * 1024;
export const RTC_BUFFER_LOW = 256 * 1024;

/** Pairing codes are short but drawn from crypto randomness. */
export const PAIR_CODE_LENGTH = 8;
export const PAIR_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** Signaling rooms are disposable. */
export const SIGNAL_TTL_MS = 10 * 60 * 1000;

export const RETENTIONS: ReadonlyArray<{ id: RetentionId; label: string; ms: number | null }> = [
  { id: '1h', label: '1 hour', ms: 60 * 60 * 1000 },
  { id: '6h', label: '6 hours', ms: 6 * 60 * 60 * 1000 },
  { id: '24h', label: '24 hours', ms: 24 * 60 * 60 * 1000 },
  { id: '7d', label: '7 days', ms: 7 * 24 * 60 * 60 * 1000 },
  { id: '30d', label: '30 days', ms: 30 * 24 * 60 * 60 * 1000 },
  { id: 'forever', label: 'Until I delete it', ms: null },
];

export const DEFAULT_RETENTION: RetentionId = '24h';

/** Database paths. Built through helpers so no caller concatenates by hand. */
export const DB_ROOT = {
  publicItems: 'workspaces/public/items',
  privateWorkspaces: 'workspaces/private',
  signals: 'signals',
} as const;

export const STORAGE_ROOT = {
  public: 'workspaces/public',
  private: 'workspaces/private',
} as const;

export const ICE_SERVERS: RTCIceServer[] = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
];
