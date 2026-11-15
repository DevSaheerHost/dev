import { describe, expect, it } from "vitest";
import { decideReconciliation } from "./reconcile";

const base = { policy: "newest_wins" as const, localQuantity: 10, lastLocalChangeAt: "2026-11-15T10:00:00Z" };

describe("POS reconciliation", () => {
  it("skips identical or missing counts", () => {
    expect(decideReconciliation({ ...base, externalQuantity: 10, externalCountedAt: "2026-11-15T11:00:00Z" })).toEqual({ action: "skip" });
    expect(decideReconciliation({ ...base, externalQuantity: null, externalCountedAt: null })).toEqual({ action: "skip" });
  });
  it("applies newer POS counts", () => {
    expect(decideReconciliation({ ...base, externalQuantity: 7, externalCountedAt: "2026-11-15T11:00:00Z" })).toEqual({ action: "apply" });
  });
  it("never overwrites newer local stock with a stale POS count", () => {
    expect(decideReconciliation({ ...base, externalQuantity: 7, externalCountedAt: "2026-11-15T09:00:00Z" }).action).toBe("conflict");
  });
  it("requires a timestamp under newest-wins", () => {
    expect(decideReconciliation({ ...base, externalQuantity: 7, externalCountedAt: null }).action).toBe("conflict");
    expect(decideReconciliation({ ...base, policy: "pos", externalQuantity: 7, externalCountedAt: null }).action).toBe("apply");
  });
  it("respects a StockPilot-wins policy and rejects negative counts", () => {
    expect(decideReconciliation({ ...base, policy: "stockpilot", externalQuantity: 7, externalCountedAt: "2026-11-16T00:00:00Z" }).action).toBe("conflict");
    expect(decideReconciliation({ ...base, policy: "pos", externalQuantity: -2, externalCountedAt: "2026-11-16T00:00:00Z" }).action).toBe("conflict");
  });
});
