import "server-only";
import type { Transaction } from "firebase-admin/firestore";
import { AppError, planError } from "@/lib/errors";
import { hashId } from "@/lib/firebase/ids";
import { formatNumber } from "@/lib/utils";
import { planMovement, type BatchState, type MovementRequest, type Rules } from "@/lib/domain/stock-engine";
import type { MemberRole, MovementType } from "@/lib/domain/types";
import { db } from "@/lib/firebase/admin";
import type { MovementDoc } from "./model";
import { notify } from "./notify";
import { biz, nowIso } from "./refs";

export interface Actor {
  userId: string | null;
  name: string | null;
  role: MemberRole;
}

export interface ApplyInput extends Omit<MovementRequest, "actorRole" | "approvedBy"> {
  productId: string;
  idempotencyKey: string;
  reason?: string | null;
  inputQuantity?: number | null;
  inputUnit?: string | null;
  aiConfidence?: number | null;
  reviewItemId?: string | null;
  auditId?: string | null;
  externalRef?: string | null;
  approvedBy?: { userId: string; name: string | null } | null;
}

export interface ApplyResult {
  movement: MovementDoc & { id: string };
  duplicate: boolean;
  alerts: ("low_stock" | "out_of_stock")[];
  reorderThreshold: number;
}

const KEY = /^[A-Za-z0-9:_-]{8,200}$/;

/**
 * Applies one stock movement inside an existing transaction. Callers that
 * need to update other documents atomically (review items, purchase orders)
 * pass their own transaction. All reads happen before any write.
 */
export async function applyMovementTx(tx: Transaction, businessId: string, rules: Rules, actor: Actor, input: ApplyInput): Promise<ApplyResult> {
  if (!KEY.test(input.idempotencyKey)) throw new AppError(400, "invalid_input", "Invalid idempotency key.");
  const ref = biz(businessId);
  const movementRef = ref.movements.doc(hashId(input.idempotencyKey));
  const productRef = ref.products.doc(input.productId);

  const [existing, productSnap, batchSnap, destination] = await Promise.all([
    tx.get(movementRef),
    tx.get(productRef),
    tx.get(ref.batches.where("productId", "==", input.productId)),
    input.type === "transfer" && input.toLocationId && /^[A-Za-z0-9_-]{8,64}$/.test(input.toLocationId) ? tx.get(ref.locations.doc(input.toLocationId)) : Promise.resolve(null),
  ]);
  if (input.type === "transfer" && !destination?.exists) throw new AppError(400, "invalid_location", "Choose a location of this business.");

  if (existing.exists) {
    const m = existing.data()!;
    if (m.productId !== input.productId || m.type !== input.type) {
      throw new AppError(409, "idempotency_conflict", "This request was already used for a different change.");
    }
    return { movement: { ...m, id: existing.id }, duplicate: true, alerts: [], reorderThreshold: productSnap.data()?.reorderThreshold ?? 0 };
  }

  const product = productSnap.data();
  if (!product) throw new AppError(404, "product_not_found", "Product not found.");
  const batches: BatchState[] = batchSnap.docs.map((d) => ({ id: d.id, batchNumber: d.data().batchNumber, expiryDate: d.data().expiryDate, quantity: d.data().quantity, unitCost: d.data().unitCost, receivedAt: d.data().receivedAt }));

  const now = nowIso();
  const plan = planMovement(
    { quantity: product.quantity, reorderThreshold: product.reorderThreshold, costPrice: product.costPrice, lastMovementAt: product.lastMovementAt, archived: !!product.archivedAt },
    batches,
    { ...input, actorRole: actor.role, approvedBy: input.approvedBy?.userId ?? null },
    rules,
    now,
  );
  if (!plan.ok) throw planError(plan.code, plan.message);

  let batchId = plan.batchId;
  for (const w of plan.batchWrites) {
    if (w.id === null) {
      // Deterministic id keeps (product, batch number, expiry) unique.
      const id = hashId(input.productId, w.batchNumber ?? "", w.expiryDate ?? "");
      tx.set(ref.batches.doc(id), {
        productId: input.productId, batchNumber: w.batchNumber ?? null, expiryDate: w.expiryDate ?? null, quantity: w.quantity,
        unitCost: w.unitCost ?? null, locationId: product.locationId, receivedAt: now, updatedAt: now,
      });
      batchId = id;
    } else {
      tx.update(ref.batches.doc(w.id), {
        quantity: w.quantity, updatedAt: now,
        ...(w.unitCost !== undefined ? { unitCost: w.unitCost } : {}),
        ...(w.locationId !== undefined ? { locationId: w.locationId } : {}),
      });
    }
  }

  tx.update(productRef, {
    quantity: plan.quantityAfter,
    costPrice: plan.newCostPrice,
    lastMovementAt: plan.lastMovementAt,
    ...(plan.countedAt ? { lastCountedAt: plan.countedAt } : {}),
    ...(plan.productLocationId !== undefined ? { locationId: plan.productLocationId } : {}),
    updatedAt: now,
  });

  const movement: MovementDoc = {
    productId: input.productId, productName: product.name, unit: product.unit, batchId, toLocationId: input.toLocationId ?? null,
    auditId: input.auditId ?? null, type: input.type, source: input.source, quantityBefore: plan.quantityBefore,
    quantityAfter: plan.quantityAfter, quantityChange: plan.change, inputQuantity: input.inputQuantity ?? null,
    inputUnit: input.inputUnit?.slice(0, 32) ?? null, allocations: plan.allocations.map((a) => ({ ...a, batchId: a.batchId ?? batchId })),
    unitCost: plan.unitCost, valueChange: plan.valueChange, reason: input.reason?.slice(0, 500) ?? (plan.clamped ? "POS oversold: clamped at zero" : null),
    actorId: actor.userId, actorName: actor.name, aiConfidence: input.aiConfidence ?? null,
    approvedBy: input.approvedBy?.userId ?? null, approvedByName: input.approvedBy?.name ?? null,
    reviewItemId: input.reviewItemId ?? null, idempotencyKey: input.idempotencyKey, externalRef: input.externalRef?.slice(0, 200) ?? null,
    observedAt: input.observedAt ?? now, createdAt: now,
  };
  // create() fails if the id exists: a second line of defence against double-apply.
  tx.create(movementRef, movement);
  return { movement: { ...movement, id: movementRef.id }, duplicate: false, alerts: plan.alerts, reorderThreshold: product.reorderThreshold };
}

/** Raise threshold alerts after a committed movement. */
export async function afterMovement(businessId: string, result: ApplyResult): Promise<void> {
  const m = result.movement;
  const day = m.createdAt.slice(0, 10);
  for (const alert of result.alerts) {
    await notify(businessId, alert === "out_of_stock"
      ? { type: "out_of_stock", severity: "critical", title: `${m.productName} is out of stock`, body: "Stock reached zero.", link: `/inventory/${m.productId}`, dedupeKey: `out_of_stock:${m.productId}:${day}` }
      : { type: "low_stock", severity: "warning", title: `${m.productName} is running low`, body: `Only ${formatNumber(m.quantityAfter)} left (reorder at ${formatNumber(result.reorderThreshold)}).`, link: `/inventory/${m.productId}`, dedupeKey: `low_stock:${m.productId}:${day}` },
    ).catch((e) => console.error("Alert failed", e));
  }
}

/** Apply one movement in its own transaction. */
export async function applyMovement(businessId: string, rules: Rules, actor: Actor, input: ApplyInput): Promise<ApplyResult> {
  const result = await db().runTransaction((tx) => applyMovementTx(tx, businessId, rules, actor, input));
  if (!result.duplicate) await afterMovement(businessId, result);
  return result;
}

export const DEDUCTION_TYPES: MovementType[] = ["sale", "damage", "expire", "missing"];
