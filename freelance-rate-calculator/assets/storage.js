/**
 * Local persistence.
 *
 * Everything stays in this browser — the app makes no network requests and
 * has no account system, so a draft quotation never leaves the machine it was
 * written on. Reads are defensive: storage can be unavailable (private mode,
 * blocked site data), full, or hold data written by an older version, and none
 * of those may break the page.
 */

const PREFIX = 'quotient.v1.';
const MAX_BYTES = 64 * 1024;

function available() {
  try {
    const probe = `${PREFIX}probe`;
    window.localStorage.setItem(probe, '1');
    window.localStorage.removeItem(probe);
    return true;
  } catch {
    return false;
  }
}

const enabled = available();

/** Read and parse a JSON value, returning `fallback` on any problem. */
export function load(key, fallback = null) {
  if (!enabled) return fallback;
  try {
    const raw = window.localStorage.getItem(PREFIX + key);
    if (!raw || raw.length > MAX_BYTES) return fallback;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : fallback;
  } catch {
    return fallback;
  }
}

/** Write a JSON value. Returns false when storage refused it. */
export function save(key, value) {
  if (!enabled) return false;
  try {
    const raw = JSON.stringify(value);
    if (raw.length > MAX_BYTES) return false;
    window.localStorage.setItem(PREFIX + key, raw);
    return true;
  } catch {
    return false;
  }
}

/** Remove a stored value. */
export function remove(key) {
  if (!enabled) return;
  try {
    window.localStorage.removeItem(PREFIX + key);
  } catch {
    /* nothing to do — the value is already unreachable */
  }
}

export const storageAvailable = enabled;
