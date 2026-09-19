/** Formatting and small pure helpers shared by the interface. */

import { RETENTIONS } from './constants';
import type { ItemKind, RetentionId } from '@/types';

const UNITS = ['B', 'KB', 'MB', 'GB'] as const;

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 B';
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const decimals = unit === 0 || value >= 100 ? 0 : 1;
  // Trim a trailing ".0" so sizes read as "3 MB" rather than "3.0 MB".
  const text = value.toFixed(decimals).replace(/\.0$/, '');
  return `${text} ${UNITS[unit]}`;
}

export function formatCount(value: number): string {
  return new Intl.NumberFormat().format(value);
}

const RELATIVE_STEPS: ReadonlyArray<[limit: number, divisor: number, unit: Intl.RelativeTimeFormatUnit]> = [
  [60_000, 1000, 'second'],
  [3_600_000, 60_000, 'minute'],
  [86_400_000, 3_600_000, 'hour'],
  [2_592_000_000, 86_400_000, 'day'],
];

export function formatRelative(timestamp: number, now = Date.now()): string {
  const diff = timestamp - now;
  const magnitude = Math.abs(diff);
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  for (const [limit, divisor, unit] of RELATIVE_STEPS) {
    if (magnitude < limit) return formatter.format(Math.round(diff / divisor), unit);
  }
  return formatter.format(Math.round(diff / 2_592_000_000), 'month');
}

/** "Expires in 4 hours" / "Kept until deleted". */
export function formatExpiry(expiresAt: number | null, now = Date.now()): string {
  if (expiresAt === null) return 'Kept until deleted';
  if (expiresAt <= now) return 'Expired';
  return `Expires ${formatRelative(expiresAt, now)}`;
}

export function retentionById(id: RetentionId) {
  return RETENTIONS.find((r) => r.id === id) ?? RETENTIONS[2]!;
}

/** Epoch ms at which an item created now should disappear. */
export function expiryFrom(retention: RetentionId, createdAt = Date.now()): number | null {
  const ms = retentionById(retention).ms;
  return ms === null ? null : createdAt + ms;
}

export function isExpired(expiresAt: number | null, now = Date.now()): boolean {
  return expiresAt !== null && expiresAt <= now;
}

/**
 * Classify a file for the interface. The browser-supplied MIME type is a hint
 * only — it decides an icon, never how the bytes are handled.
 */
export function kindFromMime(mimeType: string | undefined, fileName = ''): ItemKind {
  const mime = (mimeType ?? '').toLowerCase();
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime === 'text/plain' && /\.txt$/i.test(fileName)) return 'text';
  return 'file';
}

export const KIND_LABEL: Record<ItemKind, string> = {
  text: 'Text',
  image: 'Image',
  video: 'Video',
  audio: 'Audio',
  file: 'File',
};

/**
 * Make a filename safe to use inside a storage path: no separators, no
 * traversal, no control characters, bounded length. The original name is kept
 * in metadata, so nothing is lost for the person downloading it.
 */
export function sanitizeFileName(name: string): string {
  const base = (name ?? '')
    // Control characters are stripped on purpose, so the rule does not apply.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .replace(/[\\/]+/g, '-')
    .replace(/\.{2,}/g, '.')
    .replace(/[^A-Za-z0-9._-]/g, '-')
    .replace(/^[.-]+/, '')
    .slice(0, 96);
  return base || 'file';
}

/** Byte length of a string without allocating a second copy per keystroke. */
const encoder = new TextEncoder();
export function utf8Size(text: string): number {
  return encoder.encode(text).byteLength;
}

/** Cheap estimate for live typing: exact for ASCII, close enough above it. */
export function estimateUtf8Size(text: string): number {
  let bytes = 0;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff) {
      bytes += 4;
      i += 1;
    } else bytes += 3;
  }
  return bytes;
}

/**
 * Content types that must never be stored, because a stored file that the
 * browser will execute as a document turns shared storage into a hosting
 * service for someone else's script. Mirrored in the Storage rules, which are
 * the actual enforcement point — this check exists to give a clear message
 * instead of a generic upload failure.
 */
const ACTIVE_TYPES = [/^text\/html/, /^application\/xhtml/, /^image\/svg/, /javascript/, /^text\/xml/];

export function isActiveContentType(mimeType: string | undefined, fileName = ''): boolean {
  const mime = (mimeType ?? '').toLowerCase();
  if (ACTIVE_TYPES.some((pattern) => pattern.test(mime))) return true;
  return /\.(html?|xhtml|svg|js|mjs|cjs)$/i.test(fileName);
}
