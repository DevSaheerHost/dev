import { describe, expect, it } from 'vitest';

import {
  decryptJson,
  deriveContentKey,
  deriveWorkspaceId,
  encryptJson,
  generateSecret,
  isValidSecret,
  labelFromId,
  randomCode,
  sha256Hex,
} from '@/crypto/workspace';
import { AppError } from '@/lib/errors';

describe('workspace secrets', () => {
  it('generates 256 bits of base64url entropy', () => {
    const secret = generateSecret();
    expect(secret).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(isValidSecret(secret)).toBe(true);
  });

  it('never repeats', () => {
    const secrets = new Set(Array.from({ length: 500 }, () => generateSecret()));
    expect(secrets.size).toBe(500);
  });

  it('rejects malformed secrets', () => {
    expect(isValidSecret('')).toBe(false);
    expect(isValidSecret('short')).toBe(false);
    expect(isValidSecret('has spaces in it and is long enough to pass length')).toBe(false);
    expect(isValidSecret('../../etc/passwd')).toBe(false);
  });

  it('derives a stable, unguessable workspace id', async () => {
    const secret = generateSecret();
    const first = await deriveWorkspaceId(secret);
    const second = await deriveWorkspaceId(secret);
    expect(first).toBe(second);
    expect(first).toMatch(/^[0-9a-f]{32}$/);
  });

  it('derives different ids for different secrets', async () => {
    const a = await deriveWorkspaceId(generateSecret());
    const b = await deriveWorkspaceId(generateSecret());
    expect(a).not.toBe(b);
  });

  it('never exposes the secret through the id', async () => {
    const secret = generateSecret();
    const id = await deriveWorkspaceId(secret);
    expect(id).not.toContain(secret.slice(0, 8));
  });

  it('refuses to derive from an invalid secret', async () => {
    await expect(deriveWorkspaceId('nope')).rejects.toBeInstanceOf(AppError);
  });

  it('produces a readable label from the id', async () => {
    const id = await deriveWorkspaceId(generateSecret());
    expect(labelFromId(id)).toMatch(/^[a-z]+-[a-z]+-\d{2}$/);
  });
});

describe('content encryption', () => {
  it('round-trips a sealed payload', async () => {
    const secret = generateSecret();
    const key = await deriveContentKey(secret);
    const sealed = await encryptJson(key, { fileName: 'notes.txt', preview: 'hello' });
    expect(sealed).not.toContain('notes.txt');
    await expect(decryptJson(key, sealed)).resolves.toEqual({
      fileName: 'notes.txt',
      preview: 'hello',
    });
  });

  it('cannot be opened with a different workspace key', async () => {
    const sealed = await encryptJson(await deriveContentKey(generateSecret()), { preview: 'x' });
    const other = await deriveContentKey(generateSecret());
    await expect(decryptJson(other, sealed)).rejects.toBeInstanceOf(AppError);
  });

  it('uses a fresh nonce for every message', async () => {
    const key = await deriveContentKey(generateSecret());
    const a = await encryptJson(key, { preview: 'same' });
    const b = await encryptJson(key, { preview: 'same' });
    expect(a).not.toBe(b);
  });
});

describe('hashing and codes', () => {
  it('computes the known SHA-256 of "abc"', async () => {
    const digest = await sha256Hex(new TextEncoder().encode('abc'));
    expect(digest).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('draws pairing codes from the requested alphabet', () => {
    const code = randomCode(8, 'ABCDEFGH');
    expect(code).toHaveLength(8);
    expect(code).toMatch(/^[A-H]{8}$/);
  });
});
