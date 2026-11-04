/**
 * Document identifiers.
 *
 * Firestore retries a write it is unsure about. With server-generated ids a
 * retry can create a second document, which in a ledger means a duplicated
 * salary or a double-counted expense. So the client mints every id up front and
 * writes with `setDoc`: a retry lands on the same document and is a no-op.
 *
 * Ids are also used as path segments, so they are restricted to a character set
 * that cannot escape the collection it was meant for.
 */

/** 22 characters of base64url, i.e. 128 bits — collision-free in practice. */
const ID_BYTES = 16;
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/**
 * A random id. `crypto.getRandomValues` only — `Math.random` is not a source of
 * unique values and a collision here silently overwrites a financial record.
 */
export function randomId(prefix: string): string {
  const bytes = new Uint8Array(ID_BYTES);
  crypto.getRandomValues(bytes);
  let body = '';
  for (const byte of bytes) body += ALPHABET[byte & 63];
  return `${prefix}_${body}`;
}

/** Matches every id this app creates, including deterministic accrual ids. */
const ID_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{1,127}$/;

export function isValidId(value: unknown): value is string {
  return typeof value === 'string' && ID_PATTERN.test(value);
}

/**
 * Guards a value before it is used as a Firestore path segment. Without this a
 * crafted or corrupted id containing `/` or `..` would address a different
 * document than the one intended.
 */
export function assertId(kind: string, value: string): string {
  if (!isValidId(value)) throw new Error(`Invalid ${kind} id`);
  return value;
}

/**
 * The deterministic id of a salary or allowance accrual. Two attempts to post
 * the same month's salary are not merely discouraged, they are the same
 * document. `revision` increments when a corrected config is reposted.
 */
export function accrualId(configId: string, periodKey: string, revision = 0): string {
  assertId('income config', configId);
  if (!/^\d{4}-\d{2}$/.test(periodKey)) throw new Error('Invalid period key');
  const base = `acc_${configId}_${periodKey.replace('-', '')}`;
  return revision > 0 ? `${base}_r${revision}` : base;
}

/**
 * The deterministic id for a daily allowance actually received in a period.
 *
 * Distinct from `accrualId` so the two halves of food money — what was owed and
 * what was handed over — are separate documents that can be confirmed and
 * audited independently, while neither can be posted twice.
 */
export function allowanceReceiptId(configId: string, periodKey: string): string {
  assertId('income config', configId);
  if (!/^\d{4}-\d{2}$/.test(periodKey)) throw new Error('Invalid period key');
  return `rcv_${configId}_${periodKey.replace('-', '')}`;
}
