/** Expiration bucketing and FEFO ordering. Dates are ISO calendar days. */

export type ExpiryBucket = "expired" | "7" | "15" | "30" | "later" | "none";

export const EXPIRY_BUCKET_LABELS: Record<ExpiryBucket, string> = {
  expired: "Expired",
  "7": "Within 7 days",
  "15": "Within 15 days",
  "30": "Within 30 days",
  later: "Later",
  none: "No expiry date",
};

const DAY = 86_400_000;

function toUtcDay(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

export function todayIso(now = new Date(), timeZone = "UTC"): string {
  // en-CA formats as YYYY-MM-DD
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** Whole days from today until expiry (negative when already expired). */
export function daysUntil(expiryDate: string, today: string): number {
  return Math.round((toUtcDay(expiryDate) - toUtcDay(today)) / DAY);
}

export function expiryBucket(expiryDate: string | null | undefined, today: string): ExpiryBucket {
  if (!expiryDate) return "none";
  const days = daysUntil(expiryDate, today);
  if (days < 0) return "expired";
  if (days <= 7) return "7";
  if (days <= 15) return "15";
  if (days <= 30) return "30";
  return "later";
}

export interface BatchLike {
  id: string;
  expiryDate: string | null;
  receivedAt?: string;
  quantity: number;
}

/** First-Expired-First-Out order (undated batches last, then oldest received). */
export function fefoOrder<T extends BatchLike>(batches: T[]): T[] {
  return [...batches].sort((a, b) => {
    if (a.expiryDate && b.expiryDate && a.expiryDate !== b.expiryDate) return a.expiryDate < b.expiryDate ? -1 : 1;
    if (a.expiryDate && !b.expiryDate) return -1;
    if (!a.expiryDate && b.expiryDate) return 1;
    return (a.receivedAt ?? "").localeCompare(b.receivedAt ?? "") || a.id.localeCompare(b.id);
  });
}

/** Plan which batches a deduction would consume, FEFO. Mirrors the database. */
export function planFefoDeduction<T extends BatchLike>(batches: T[], amount: number): { batchId: string; quantity: number }[] {
  const plan: { batchId: string; quantity: number }[] = [];
  let remaining = amount;
  for (const b of fefoOrder(batches)) {
    if (remaining <= 0) break;
    if (b.quantity <= 0) continue;
    const take = Math.min(b.quantity, remaining);
    plan.push({ batchId: b.id, quantity: take });
    remaining -= take;
  }
  return plan;
}

export function expiryLoss(quantity: number, unitCost: number): number {
  return Math.round(quantity * unitCost * 100) / 100;
}
