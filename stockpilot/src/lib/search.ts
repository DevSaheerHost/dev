/** Validation helpers for URL search params. */
export function pageNumber(p: string | string[] | undefined): number {
  const n = Number(Array.isArray(p) ? p[0] : p);
  return Number.isInteger(n) && n > 0 && n < 10_000 ? n : 1;
}

export function oneOf<T extends string>(value: string | string[] | undefined, allowed: readonly T[], fallback: T): T {
  const v = Array.isArray(value) ? value[0] : value;
  return allowed.includes(v as T) ? (v as T) : fallback;
}
