import { describe, expect, it } from 'vitest';

import { MAX_FILE_BYTES, MAX_TEXT_BYTES } from '@/lib/constants';
import {
  estimateUtf8Size,
  expiryFrom,
  formatBytes,
  isExpired,
  kindFromMime,
  sanitizeFileName,
  utf8Size,
} from '@/lib/format';
import { assertItemId, assertPairCode, assertWorkspaceId } from '@/firebase/paths';
import { AppError } from '@/lib/errors';

describe('expiration', () => {
  const now = 1_700_000_000_000;

  it('computes the expiry for each retention window', () => {
    expect(expiryFrom('1h', now)).toBe(now + 3_600_000);
    expect(expiryFrom('6h', now)).toBe(now + 21_600_000);
    expect(expiryFrom('24h', now)).toBe(now + 86_400_000);
    expect(expiryFrom('7d', now)).toBe(now + 604_800_000);
    expect(expiryFrom('30d', now)).toBe(now + 2_592_000_000);
  });

  it('returns null for items kept until deleted', () => {
    expect(expiryFrom('forever', now)).toBeNull();
  });

  it('treats a past timestamp as expired and null as never', () => {
    expect(isExpired(now - 1, now)).toBe(true);
    expect(isExpired(now + 1, now)).toBe(false);
    expect(isExpired(now, now)).toBe(true);
    expect(isExpired(null, now)).toBe(false);
  });
});

describe('file metadata', () => {
  it('classifies by MIME type, falling back to a generic file', () => {
    expect(kindFromMime('image/png')).toBe('image');
    expect(kindFromMime('video/mp4')).toBe('video');
    expect(kindFromMime('audio/mpeg')).toBe('audio');
    expect(kindFromMime('application/pdf')).toBe('file');
    expect(kindFromMime(undefined)).toBe('file');
    expect(kindFromMime('')).toBe('file');
  });

  it('sanitises filenames before they reach a storage path', () => {
    expect(sanitizeFileName('holiday photo.jpg')).toBe('holiday-photo.jpg');
    expect(sanitizeFileName('../../etc/passwd')).toBe('etc-passwd');
    expect(sanitizeFileName('a/b\\c.txt')).toBe('a-b-c.txt');
    expect(sanitizeFileName('....hidden')).toBe('hidden');
    expect(sanitizeFileName('')).toBe('file');
    expect(sanitizeFileName('x'.repeat(400))).toHaveLength(96);
  });

  it('keeps a sanitised name free of path separators', () => {
    const name = sanitizeFileName('dir/../../root#/file$name[0].zip');
    expect(name).not.toMatch(/[\\/#$[\]]/);
  });
});

describe('size validation', () => {
  it('measures UTF-8 length exactly', () => {
    expect(utf8Size('abc')).toBe(3);
    expect(utf8Size('é')).toBe(2);
    expect(utf8Size('日')).toBe(3);
    expect(utf8Size('🚀')).toBe(4);
  });

  it('estimates the same size without allocating a copy', () => {
    const samples = ['abc', 'é', '日本語', '🚀🚀', 'mixed ascii and 日本語 and 🚀'];
    for (const sample of samples) {
      expect(estimateUtf8Size(sample)).toBe(utf8Size(sample));
    }
  });

  it('holds the documented limits', () => {
    expect(MAX_FILE_BYTES).toBe(3 * 1024 * 1024);
    expect(MAX_TEXT_BYTES).toBe(3 * 1024 * 1024);
    expect(formatBytes(MAX_FILE_BYTES)).toBe('3 MB');
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
  });
});

describe('path safety', () => {
  it('accepts well-formed identifiers', () => {
    expect(assertWorkspaceId('a'.repeat(32))).toHaveLength(32);
    expect(assertItemId('Abc-123_xyz9')).toBe('Abc-123_xyz9');
    expect(assertPairCode('ABCD2345')).toBe('ABCD2345');
  });

  it('rejects anything that could escape its path', () => {
    for (const bad of ['../secret', 'a/b', 'has space', 'ZZZZ', '#fragment', '', '.']) {
      expect(() => assertWorkspaceId(bad)).toThrow(AppError);
    }
    for (const bad of ['../secret', 'a/b', 'short', '$ref', 'a'.repeat(200)]) {
      expect(() => assertItemId(bad)).toThrow(AppError);
    }
    expect(() => assertPairCode('abcd')).toThrow(AppError);
    expect(() => assertPairCode('AB/CD')).toThrow(AppError);
  });
});

describe('content type safety', () => {
  it('refuses types a browser would execute as a document', async () => {
    const { isActiveContentType } = await import('@/lib/format');
    expect(isActiveContentType('text/html', 'page.html')).toBe(true);
    expect(isActiveContentType('image/svg+xml', 'logo.svg')).toBe(true);
    expect(isActiveContentType('application/javascript', 'app.js')).toBe(true);
    expect(isActiveContentType('application/octet-stream', 'sneaky.html')).toBe(true);
  });

  it('accepts ordinary payloads', async () => {
    const { isActiveContentType } = await import('@/lib/format');
    expect(isActiveContentType('image/png', 'photo.png')).toBe(false);
    expect(isActiveContentType('video/mp4', 'clip.mp4')).toBe(false);
    expect(isActiveContentType('application/pdf', 'doc.pdf')).toBe(false);
    expect(isActiveContentType('application/zip', 'bundle.zip')).toBe(false);
    expect(isActiveContentType(undefined, 'notes.txt')).toBe(false);
  });
});
