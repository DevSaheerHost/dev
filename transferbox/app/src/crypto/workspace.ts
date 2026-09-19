/**
 * Workspace cryptography.
 *
 * A private workspace is identified by a 256-bit secret generated with
 * `crypto.getRandomValues`. Two independent values are derived from it:
 *
 *   workspace id  = SHA-256("transferbox/v1/id"  || secret)  → sent to the server
 *   content key   = SHA-256("transferbox/v1/key" || secret)  → never leaves the device
 *
 * The server therefore stores an unguessable 128-bit path segment and
 * ciphertext, and knowing the id does not reveal the secret or the key. Content
 * in a private workspace is sealed with AES-GCM before it is uploaded, so the
 * privacy claim in the interface is one the storage layer actually keeps.
 *
 * The secret itself is never logged, never placed in a query string, and never
 * sent anywhere: share links carry it in the URL fragment, which browsers do
 * not transmit to servers.
 */

import { AppError } from '@/lib/errors';

const ID_CONTEXT = 'transferbox/v1/id';
const KEY_CONTEXT = 'transferbox/v1/key';
const SECRET_BYTES = 32;
const ID_HEX_LENGTH = 32; // 128 bits of the digest
const IV_BYTES = 12;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function subtle(): SubtleCrypto {
  const api = globalThis.crypto?.subtle;
  if (!api) throw new AppError('unsupported');
  return api;
}

export function randomBytes(length: number): Uint8Array {
  const out = new Uint8Array(length);
  globalThis.crypto.getRandomValues(out);
  return out;
}

export function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64Url(value: string): Uint8Array {
  const normalised = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalised + '='.repeat((4 - (normalised.length % 4)) % 4);
  const binary = atob(padded);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

export function toHex(bytes: Uint8Array): string {
  let hex = '';
  for (const byte of bytes) hex += byte.toString(16).padStart(2, '0');
  return hex;
}

/** A fresh 256-bit workspace secret. */
export function generateSecret(): string {
  return toBase64Url(randomBytes(SECRET_BYTES));
}

/** Reject anything that is not a plausible secret before it touches the network. */
export function isValidSecret(secret: string): boolean {
  return typeof secret === 'string' && /^[A-Za-z0-9_-]{22,88}$/.test(secret);
}

export async function sha256(data: BufferSource): Promise<Uint8Array> {
  const digest = await subtle().digest('SHA-256', data);
  return new Uint8Array(digest);
}

export async function sha256Hex(data: BufferSource): Promise<string> {
  return toHex(await sha256(data));
}

async function derive(context: string, secret: string): Promise<Uint8Array> {
  return sha256(encoder.encode(`${context}:${secret}`));
}

/** The public, server-visible identifier for a private workspace. */
export async function deriveWorkspaceId(secret: string): Promise<string> {
  if (!isValidSecret(secret)) throw new AppError('workspace-invalid');
  return toHex(await derive(ID_CONTEXT, secret)).slice(0, ID_HEX_LENGTH);
}

/** The AES-GCM key that seals everything stored in a private workspace. */
export async function deriveContentKey(secret: string): Promise<CryptoKey> {
  if (!isValidSecret(secret)) throw new AppError('workspace-invalid');
  const material = await derive(KEY_CONTEXT, secret);
  return subtle().importKey('raw', material as BufferSource, { name: 'AES-GCM' }, false, [
    'encrypt',
    'decrypt',
  ]);
}

const LABEL_WORDS = [
  'amber', 'basalt', 'cedar', 'delta', 'ember', 'fjord', 'granite', 'harbor',
  'indigo', 'juniper', 'kelp', 'lumen', 'meridian', 'nimbus', 'onyx', 'pine',
  'quartz', 'reef', 'summit', 'tundra', 'umber', 'vertex', 'willow', 'zephyr',
] as const;

/**
 * A short, human-friendly name so people can tell two workspaces apart.
 * Derived from the id, never from the secret, and purely cosmetic.
 */
export function labelFromId(id: string): string {
  const first = parseInt(id.slice(0, 4), 16) % LABEL_WORDS.length;
  const second = parseInt(id.slice(4, 8), 16) % LABEL_WORDS.length;
  const number = parseInt(id.slice(8, 12), 16) % 100;
  return `${LABEL_WORDS[first]}-${LABEL_WORDS[second]}-${String(number).padStart(2, '0')}`;
}

/** AES-GCM seal. The IV is random per message and prefixed to the ciphertext. */
export async function encryptBytes(key: CryptoKey, data: BufferSource): Promise<Uint8Array> {
  const iv = randomBytes(IV_BYTES);
  const sealed = await subtle().encrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key, data);
  const out = new Uint8Array(iv.length + sealed.byteLength);
  out.set(iv, 0);
  out.set(new Uint8Array(sealed), iv.length);
  return out;
}

export async function decryptBytes(key: CryptoKey, payload: Uint8Array): Promise<Uint8Array> {
  if (payload.length <= IV_BYTES) throw new AppError('workspace-invalid');
  const iv = payload.slice(0, IV_BYTES);
  const body = payload.slice(IV_BYTES);
  try {
    const open = await subtle().decrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key, body as BufferSource);
    return new Uint8Array(open);
  } catch (error) {
    throw new AppError('workspace-invalid', error);
  }
}

export async function encryptJson(key: CryptoKey, value: unknown): Promise<string> {
  return toBase64Url(await encryptBytes(key, encoder.encode(JSON.stringify(value))));
}

export async function decryptJson<T>(key: CryptoKey, payload: string): Promise<T> {
  const bytes = await decryptBytes(key, fromBase64Url(payload));
  return JSON.parse(decoder.decode(bytes)) as T;
}

/** Pairing codes for direct transfer: short, but still from real randomness. */
export function randomCode(length: number, alphabet: string): string {
  const bytes = randomBytes(length);
  let out = '';
  for (const byte of bytes) out += alphabet[byte % alphabet.length];
  return out;
}
