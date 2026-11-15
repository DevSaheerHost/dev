/** Make free text safe to embed in a PostgREST `or=(...)` filter. */
export function postgrestSearchTerm(q: string | string[] | undefined, max = 80): string {
  const value = Array.isArray(q) ? q[0] : q;
  return (value ?? "").replace(/[,()*%\\:"']/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

export function pageNumber(p: string | string[] | undefined): number {
  const n = Number(Array.isArray(p) ? p[0] : p);
  return Number.isInteger(n) && n > 0 && n < 10_000 ? n : 1;
}

export function oneOf<T extends string>(value: string | string[] | undefined, allowed: readonly T[], fallback: T): T {
  const v = Array.isArray(value) ? value[0] : value;
  return allowed.includes(v as T) ? (v as T) : fallback;
}
