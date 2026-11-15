/**
 * Stock engine rules (pure). The Firestore transaction in lib/data/stock.ts
 * reads current state, asks this planner what to write, and writes it
 * atomically. Keeping the rules pure makes every invariant unit-testable.
 *
 * Invariants
 *  - Quantities are in the product's base unit and never go negative
 *    (POS sales are clamped and flagged instead of failing).
 *  - sum(batch quantities) <= product quantity; the rest is "unbatched".
 *  - Sales and expiries consume batches First-Expired-First-Out.
 *  - Other losses consume unbatched stock first, then trim batches FEFO.
 *  - A count observed before the last recorded change is refused (stale).
 *  - Employees can't make large adjustments, corrections, transfers or
 *    opening-stock entries without manager approval.
 */
import { fefoOrder } from "./expiry";
import type { MemberRole, MovementSource, MovementType } from "./types";

export interface ProductState {
  quantity: number;
  reorderThreshold: number;
  costPrice: number;
  lastMovementAt: string | null;
  archived: boolean;
}

export interface BatchState {
  id: string;
  batchNumber: string | null;
  expiryDate: string | null;
  quantity: number;
  unitCost: number | null;
  receivedAt: string;
}

export interface MovementRequest {
  type: MovementType;
  /** Absolute count for set_count, signed delta for correction, magnitude otherwise. */
  quantity: number;
  source: MovementSource;
  actorRole: MemberRole;
  /** Set when a manager/owner approved (lifts employee limits). */
  approvedBy: string | null;
  batchId?: string | null;
  batchNumber?: string | null;
  expiryDate?: string | null;
  unitCost?: number | null;
  toLocationId?: string | null;
  observedAt?: string | null;
}

export interface Rules {
  largeAdjustmentUnits: number;
  largeAdjustmentPercent: number;
}

export interface BatchWrite {
  /** Existing batch id, or null to create a new batch. */
  id: string | null;
  quantity: number;
  batchNumber?: string | null;
  expiryDate?: string | null;
  unitCost?: number | null;
  /** Amount added to an existing batch (for create-or-increment). */
  increment?: number;
  locationId?: string | null;
}

export type PlanError = { ok: false; code: string; message: string };

export interface MovementPlan {
  ok: true;
  quantityBefore: number;
  quantityAfter: number;
  change: number;
  batchWrites: BatchWrite[];
  allocations: { batchId: string | null; quantity: number }[];
  batchId: string | null;
  unitCost: number;
  valueChange: number;
  newCostPrice: number;
  countedAt: string | null;
  lastMovementAt: string;
  alerts: ("low_stock" | "out_of_stock")[];
  clamped: boolean;
  productLocationId?: string | null;
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;
const round2 = (n: number) => Math.round(n * 100) / 100;
const fail = (code: string, message: string): PlanError => ({ ok: false, code, message });

const DEDUCTIONS: MovementType[] = ["sale", "damage", "expire", "missing"];
export const MAX_QUANTITY = 10_000_000;

export function isLargeChange(change: number, before: number, rules: Rules): boolean {
  const pct = before > 0 ? (Math.abs(change) / before) * 100 : 0;
  return Math.abs(change) > rules.largeAdjustmentUnits || (before >= 10 && pct > rules.largeAdjustmentPercent);
}

function deductFefo(batches: BatchState[], amount: number): { writes: BatchWrite[]; allocations: { batchId: string; quantity: number }[] } {
  const writes: BatchWrite[] = [];
  const allocations: { batchId: string; quantity: number }[] = [];
  let remaining = amount;
  for (const b of fefoOrder(batches)) {
    if (remaining <= 0) break;
    if (b.quantity <= 0) continue;
    const take = round3(Math.min(b.quantity, remaining));
    writes.push({ id: b.id, quantity: round3(b.quantity - take) });
    allocations.push({ batchId: b.id, quantity: take });
    remaining = round3(remaining - take);
  }
  return { writes, allocations };
}

export function planMovement(
  product: ProductState,
  batches: BatchState[],
  req: MovementRequest,
  rules: Rules,
  now: string,
): MovementPlan | PlanError {
  const q = req.quantity;
  if (!Number.isFinite(q)) return fail("invalid_quantity", "Quantity is required.");
  if (req.type !== "correction" && q < 0) return fail("invalid_quantity", "Quantity must be non-negative.");
  if (req.type !== "set_count" && req.type !== "correction" && q === 0) return fail("invalid_quantity", "Quantity must be greater than zero.");
  if (req.type === "correction" && q === 0) return fail("invalid_quantity", "A correction can't be zero.");
  if (Math.abs(q) > MAX_QUANTITY) return fail("invalid_quantity", "Quantity is unrealistically large.");
  if (product.archived && req.source !== "pos") return fail("product_archived", "This product is archived.");
  if (["correction", "transfer", "initial"].includes(req.type) && req.actorRole === "employee" && !req.approvedBy) {
    return fail("forbidden", `${req.type} requires a manager.`);
  }

  const observed = req.observedAt ?? now;
  if (req.type === "set_count" && product.lastMovementAt && Date.parse(observed) < Date.parse(product.lastMovementAt)) {
    return fail("stale_observation", "Stock changed after this count was taken.");
  }

  const before = round3(product.quantity);
  let change: number;
  switch (req.type) {
    case "receive":
    case "return":
    case "initial":
    case "correction":
      change = q;
      break;
    case "sale":
    case "damage":
    case "expire":
    case "missing":
      change = -q;
      break;
    case "set_count":
      change = q - before;
      break;
    case "transfer":
      change = 0;
      break;
  }
  change = round3(change);

  let clamped = false;
  if (before + change < 0) {
    if (req.source === "pos" && req.type === "sale") {
      change = -before;
      clamped = true;
    } else {
      return fail("insufficient_stock", `Only ${before} on hand, can't remove ${-change}.`);
    }
  }

  if (req.actorRole === "employee" && !req.approvedBy && req.type !== "sale" && req.source !== "purchase" && isLargeChange(change, before, rules)) {
    return fail("approval_required", "This change is large enough to need a manager's approval.");
  }

  const after = round3(before + change);
  const batchWrites: BatchWrite[] = [];
  let allocations: { batchId: string | null; quantity: number }[] = [];
  let batchId: string | null = null;
  let batchCost: number | null = null;
  let productLocationId: string | null | undefined;

  const namesBatch = !!(req.batchId || req.batchNumber || req.expiryDate);
  if (["receive", "return", "initial"].includes(req.type) && namesBatch) {
    if (req.batchId) {
      const b = batches.find((x) => x.id === req.batchId);
      if (!b) return fail("batch_not_found", "Batch not found.");
      batchWrites.push({ id: b.id, quantity: round3(b.quantity + q) });
      batchId = b.id;
      batchCost = b.unitCost;
    } else {
      const number = req.batchNumber?.trim() || null;
      const existing = batches.find((b) => (b.batchNumber ?? null) === number && (b.expiryDate ?? null) === (req.expiryDate ?? null));
      if (existing) {
        batchWrites.push({ id: existing.id, quantity: round3(existing.quantity + q), unitCost: req.unitCost ?? existing.unitCost });
        batchId = existing.id;
      } else {
        batchWrites.push({ id: null, quantity: q, batchNumber: number, expiryDate: req.expiryDate ?? null, unitCost: req.unitCost ?? null });
      }
    }
    allocations = [{ batchId, quantity: q }];
  } else if (change < 0) {
    const batchTotal = batches.reduce((s, b) => s + Math.max(0, b.quantity), 0);
    let plan: ReturnType<typeof deductFefo> = { writes: [], allocations: [] };
    if (req.batchId) {
      const b = batches.find((x) => x.id === req.batchId);
      if (!b) return fail("batch_not_found", "Batch not found.");
      if (b.quantity < -change) return fail("insufficient_batch_stock", "That batch doesn't have that many left.");
      plan = { writes: [{ id: b.id, quantity: round3(b.quantity + change) }], allocations: [{ batchId: b.id, quantity: -change }] };
      batchCost = b.unitCost;
    } else if (DEDUCTIONS.includes(req.type) && (req.type === "sale" || req.type === "expire")) {
      plan = deductFefo(batches, Math.min(-change, batchTotal));
    } else if (batchTotal > after) {
      plan = deductFefo(batches, round3(batchTotal - after));
    }
    batchWrites.push(...plan.writes);
    allocations = plan.allocations;
    if (plan.allocations.length === 1) {
      batchId = plan.allocations[0].batchId;
      batchCost ??= batches.find((b) => b.id === batchId)?.unitCost ?? null;
    }
  } else if (req.type === "transfer") {
    if (!req.toLocationId) return fail("invalid_location", "Choose where the stock moved to.");
    if (req.batchId) {
      const b = batches.find((x) => x.id === req.batchId);
      if (!b) return fail("batch_not_found", "Batch not found.");
      batchWrites.push({ id: b.id, quantity: b.quantity, locationId: req.toLocationId });
      batchId = b.id;
    } else {
      productLocationId = req.toLocationId;
    }
  }

  const unitCost = round2(req.unitCost ?? batchCost ?? product.costPrice ?? 0);
  const newCostPrice =
    ["receive", "initial"].includes(req.type) && req.unitCost != null && after > 0
      ? round2((before * product.costPrice + q * req.unitCost) / after)
      : product.costPrice;

  const alerts: MovementPlan["alerts"] = [];
  if (after <= 0 && before > 0) alerts.push("out_of_stock");
  else if (after < product.reorderThreshold && before >= product.reorderThreshold) alerts.push("low_stock");

  const lastMovementAt = Date.parse(observed) > Date.parse(now) ? observed : now;
  return {
    ok: true,
    quantityBefore: before,
    quantityAfter: after,
    change,
    batchWrites,
    allocations,
    batchId,
    unitCost,
    valueChange: round2(change * unitCost),
    newCostPrice,
    countedAt: req.type === "set_count" ? observed : null,
    lastMovementAt,
    alerts,
    clamped,
    productLocationId,
  };
}
