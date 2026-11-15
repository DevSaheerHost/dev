import { describe, expect, it } from "vitest";
import { planMovement, type BatchState, type MovementRequest, type ProductState } from "./stock-engine";

const NOW = "2026-11-15T10:00:00.000Z";
const rules = { largeAdjustmentUnits: 50, largeAdjustmentPercent: 50 };
const product = (p: Partial<ProductState> = {}): ProductState => ({ quantity: 10, reorderThreshold: 5, costPrice: 2, lastMovementAt: null, archived: false, ...p });
const req = (r: Partial<MovementRequest>): MovementRequest => ({ type: "receive", quantity: 1, source: "manual", actorRole: "owner", approvedBy: null, ...r });
const batch = (id: string, expiryDate: string | null, quantity: number, unitCost: number | null = null): BatchState => ({ id, batchNumber: id, expiryDate, quantity, unitCost, receivedAt: "2026-01-01T00:00:00Z" });

function ok(r: ReturnType<typeof planMovement>) {
  if (!r.ok) throw new Error(`${r.code}: ${r.message}`);
  return r;
}

describe("stock engine planner", () => {
  it("applies receive, sale and count with the right signed change", () => {
    expect(ok(planMovement(product(), [], req({ type: "receive", quantity: 12 }), rules, NOW))).toMatchObject({ quantityBefore: 10, quantityAfter: 22, change: 12 });
    expect(ok(planMovement(product(), [], req({ type: "sale", quantity: 2 }), rules, NOW))).toMatchObject({ quantityAfter: 8, change: -2 });
    expect(ok(planMovement(product(), [], req({ type: "set_count", quantity: 7 }), rules, NOW))).toMatchObject({ quantityAfter: 7, change: -3, countedAt: NOW });
  });

  it("never goes negative, except clamped POS sales", () => {
    expect(planMovement(product({ quantity: 2 }), [], req({ type: "damage", quantity: 3 }), rules, NOW)).toMatchObject({ ok: false, code: "insufficient_stock" });
    expect(ok(planMovement(product({ quantity: 1 }), [], req({ type: "sale", quantity: 3, source: "pos" }), rules, NOW))).toMatchObject({ quantityAfter: 0, clamped: true });
  });

  it("validates quantities", () => {
    expect(planMovement(product(), [], req({ quantity: -1 }), rules, NOW)).toMatchObject({ code: "invalid_quantity" });
    expect(planMovement(product(), [], req({ quantity: 0 }), rules, NOW)).toMatchObject({ code: "invalid_quantity" });
    expect(planMovement(product(), [], req({ quantity: Number.NaN }), rules, NOW)).toMatchObject({ code: "invalid_quantity" });
    expect(planMovement(product(), [], req({ quantity: 1e9 }), rules, NOW)).toMatchObject({ code: "invalid_quantity" });
    expect(ok(planMovement(product(), [], req({ type: "set_count", quantity: 0 }), rules, NOW)).quantityAfter).toBe(0);
  });

  it("deducts sales First-Expired-First-Out across batches", () => {
    const plan = ok(planMovement(product({ quantity: 9 }), [batch("LATE", "2030-06-01", 5), batch("EARLY", "2030-01-01", 4)], req({ type: "sale", quantity: 6 }), rules, NOW));
    expect(plan.batchWrites).toEqual([{ id: "EARLY", quantity: 0 }, { id: "LATE", quantity: 3 }]);
    expect(plan.allocations).toHaveLength(2);
  });

  it("records expiry against a named batch and values the loss", () => {
    const batches = [batch("B1", "2020-01-01", 10, 5), batch("B2", "2031-01-01", 10, 5)];
    const plan = ok(planMovement(product({ quantity: 20, costPrice: 5 }), batches, req({ type: "expire", quantity: 10, batchId: "B1" }), rules, NOW));
    expect(plan).toMatchObject({ batchId: "B1", change: -10, valueChange: -50, quantityAfter: 10 });
    expect(planMovement(product({ quantity: 10 }), [batch("B1", "2020-01-01", 0)], req({ type: "expire", quantity: 1, batchId: "B1" }), rules, NOW)).toMatchObject({ code: "insufficient_batch_stock" });
  });

  it("consumes unbatched stock first on other losses and trims batches on counts", () => {
    const batches = [batch("X", "2030-01-01", 6)];
    const damage = ok(planMovement(product({ quantity: 10 }), batches, req({ type: "damage", quantity: 5 }), rules, NOW));
    expect(damage.batchWrites).toEqual([{ id: "X", quantity: 5 }]);
    const count = ok(planMovement(product({ quantity: 5 }), [batch("X", "2030-01-01", 5)], req({ type: "set_count", quantity: 2 }), rules, NOW));
    expect(count.batchWrites).toEqual([{ id: "X", quantity: 2 }]);
  });

  it("creates or increments batches on receipt", () => {
    const created = ok(planMovement(product(), [], req({ quantity: 4, batchNumber: "L1", expiryDate: "2030-01-01" }), rules, NOW));
    expect(created.batchWrites).toEqual([{ id: null, quantity: 4, batchNumber: "L1", expiryDate: "2030-01-01", unitCost: null }]);
    const incremented = ok(planMovement(product(), [batch("L1", "2030-01-01", 3)], req({ quantity: 4, batchNumber: "L1", expiryDate: "2030-01-01" }), rules, NOW));
    expect(incremented.batchWrites[0]).toMatchObject({ id: "L1", quantity: 7 });
  });

  it("refuses stale counts that predate newer changes", () => {
    const p = product({ lastMovementAt: NOW });
    expect(planMovement(p, [], req({ type: "set_count", quantity: 3, observedAt: "2026-11-15T09:00:00Z" }), rules, NOW)).toMatchObject({ code: "stale_observation" });
    expect(ok(planMovement(p, [], req({ type: "set_count", quantity: 3, observedAt: "2026-11-15T10:30:00Z" }), rules, "2026-11-15T10:31:00Z")).quantityAfter).toBe(3);
  });

  it("requires a manager for large employee changes, corrections and transfers", () => {
    const emp = { actorRole: "employee" as const };
    expect(planMovement(product({ quantity: 40 }), [], req({ ...emp, type: "receive", quantity: 200 }), rules, NOW)).toMatchObject({ code: "approval_required" });
    expect(planMovement(product({ quantity: 40 }), [], req({ ...emp, type: "set_count", quantity: 2 }), rules, NOW)).toMatchObject({ code: "approval_required" });
    expect(ok(planMovement(product({ quantity: 40 }), [], req({ ...emp, type: "set_count", quantity: 36 }), rules, NOW)).quantityAfter).toBe(36);
    expect(ok(planMovement(product({ quantity: 40 }), [], req({ ...emp, type: "set_count", quantity: 2, approvedBy: "mgr" }), rules, NOW)).quantityAfter).toBe(2);
    expect(planMovement(product(), [], req({ ...emp, type: "correction", quantity: 3 }), rules, NOW)).toMatchObject({ code: "forbidden" });
    expect(planMovement(product(), [], req({ ...emp, type: "transfer", quantity: 1, toLocationId: "loc" }), rules, NOW)).toMatchObject({ code: "forbidden" });
    expect(ok(planMovement(product({ quantity: 400 }), [], req({ ...emp, type: "sale", quantity: 300 }), rules, NOW)).quantityAfter).toBe(100);
  });

  it("maintains weighted average cost on receipt", () => {
    expect(ok(planMovement(product({ quantity: 10, costPrice: 2 }), [], req({ quantity: 10, unitCost: 4 }), rules, NOW)).newCostPrice).toBe(3);
  });

  it("raises low-stock and out-of-stock alerts only when crossing thresholds", () => {
    expect(ok(planMovement(product({ quantity: 12, reorderThreshold: 10 }), [], req({ type: "sale", quantity: 5 }), rules, NOW)).alerts).toEqual(["low_stock"]);
    expect(ok(planMovement(product({ quantity: 7, reorderThreshold: 10 }), [], req({ type: "sale", quantity: 1 }), rules, NOW)).alerts).toEqual([]);
    expect(ok(planMovement(product({ quantity: 2, reorderThreshold: 10 }), [], req({ type: "sale", quantity: 2 }), rules, NOW)).alerts).toEqual(["out_of_stock"]);
  });

  it("blocks archived products except for POS", () => {
    expect(planMovement(product({ archived: true }), [], req({}), rules, NOW)).toMatchObject({ code: "product_archived" });
  });

  it("moves stock between locations without changing the total", () => {
    const plan = ok(planMovement(product(), [], req({ type: "transfer", quantity: 3, toLocationId: "back" }), rules, NOW));
    expect(plan).toMatchObject({ change: 0, quantityAfter: 10, productLocationId: "back" });
  });
});
