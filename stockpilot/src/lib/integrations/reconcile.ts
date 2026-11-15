/**
 * Decide what to do with a stock count reported by a POS.
 *
 *  - Same quantity                      -> skip
 *  - policy "stockpilot"                -> never overwrite; record a conflict
 *  - POS count older than our last change -> conflict (never overwrite newer data)
 *  - unknown POS timestamp under "newest_wins" -> conflict (can't prove it's newer)
 *  - otherwise                          -> apply as a stock count
 */
export type ConflictPolicy = "newest_wins" | "pos" | "stockpilot";
export type Decision = { action: "skip" } | { action: "apply" } | { action: "conflict"; reason: string };

export function decideReconciliation(input: {
  policy: ConflictPolicy;
  localQuantity: number;
  externalQuantity: number | null;
  lastLocalChangeAt: string | null;
  externalCountedAt: string | null;
}): Decision {
  const { policy, localQuantity, externalQuantity, lastLocalChangeAt, externalCountedAt } = input;
  if (externalQuantity === null || !Number.isFinite(externalQuantity)) return { action: "skip" };
  if (Math.abs(externalQuantity - localQuantity) < 0.0005) return { action: "skip" };
  if (externalQuantity < 0) return { action: "conflict", reason: `POS reports a negative count (${externalQuantity}).` };
  if (policy === "stockpilot") return { action: "conflict", reason: "StockPilot counts are set to win; POS value not applied." };
  if (!externalCountedAt) {
    return policy === "pos" ? { action: "apply" } : { action: "conflict", reason: "POS count has no timestamp, so it can't be proven newer." };
  }
  if (lastLocalChangeAt && Date.parse(externalCountedAt) < Date.parse(lastLocalChangeAt)) {
    return { action: "conflict", reason: "POS count is older than the latest StockPilot change." };
  }
  return { action: "apply" };
}
