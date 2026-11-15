import "server-only";
import type { AppContext } from "@/lib/auth/session";
import { AppError, invalid, notFound } from "@/lib/errors";
import { db } from "@/lib/firebase/admin";
import { hashId, isDocId, newId } from "@/lib/firebase/ids";
import { planDraftOrders, type ReorderCandidate } from "@/lib/domain/reorder";
import { assertRole } from "./business";
import { loadProducts } from "./catalog";
import type { PurchaseOrderDoc, PurchaseOrderLine, SupplierDoc } from "./model";
import { logActivity, notify } from "./notify";
import { biz, nowIso } from "./refs";
import { afterMovement, applyMovementTx, type ApplyResult } from "./stock";

const round2 = (n: number) => Math.round(n * 100) / 100;
const subtotal = (lines: PurchaseOrderLine[]) => round2(lines.reduce((s, l) => s + l.quantity * l.unitCost, 0));

// ── Suppliers ───────────────────────────────────────────────────────────────
export type SupplierInput = Omit<SupplierDoc, "nameLower" | "archivedAt" | "createdAt" | "updatedAt">;

export async function listSuppliers(businessId: string) {
  const snap = await biz(businessId).suppliers.where("archivedAt", "==", null).get();
  return snap.docs.map((d) => ({ ...d.data(), id: d.id })).sort((a, b) => a.nameLower.localeCompare(b.nameLower));
}

export async function getSupplier(businessId: string, id: string) {
  if (!isDocId(id)) return null;
  const s = await biz(businessId).suppliers.doc(id).get();
  return s.exists ? { ...s.data()!, id } : null;
}

export async function saveSupplier(ctx: AppContext, input: SupplierInput, id?: string): Promise<string> {
  assertRole(ctx, "manager", "Only managers and owners can manage suppliers.");
  const ref = biz(ctx.business.id).suppliers;
  const now = nowIso();
  if (id) {
    if (!isDocId(id) || !(await ref.doc(id).get()).exists) throw notFound("Supplier");
    await ref.doc(id).update({ ...input, nameLower: input.name.toLowerCase(), updatedAt: now });
    return id;
  }
  const newRef = ref.doc(newId());
  await newRef.create({ ...input, nameLower: input.name.toLowerCase(), archivedAt: null, createdAt: now, updatedAt: now });
  return newRef.id;
}

export async function archiveSupplier(ctx: AppContext, id: string) {
  assertRole(ctx, "manager");
  if (!isDocId(id)) throw notFound("Supplier");
  await biz(ctx.business.id).suppliers.doc(id).update({ archivedAt: nowIso() });
}

export async function linkSupplierProduct(ctx: AppContext, input: { supplierId: string; productId: string; supplierSku: string | null; unitCost: number; packSize: number; leadTimeDays: number | null; preferred: boolean }) {
  assertRole(ctx, "manager");
  const ref = biz(ctx.business.id);
  if (!isDocId(input.supplierId) || !isDocId(input.productId)) throw invalid("Invalid selection.");
  const [s, p] = await Promise.all([ref.suppliers.doc(input.supplierId).get(), ref.products.doc(input.productId).get()]);
  if (!s.exists || !p.exists) throw invalid("Unknown supplier or product.");
  const linkRef = ref.supplierProducts.doc(`${input.supplierId}_${input.productId}`);
  const previous = (await linkRef.get()).data();
  const now = nowIso();
  await linkRef.set({ supplierId: input.supplierId, productId: input.productId, supplierSku: input.supplierSku, unitCost: input.unitCost, packSize: input.packSize, leadTimeDays: input.leadTimeDays, updatedAt: now });
  if (!previous || previous.unitCost !== input.unitCost) {
    await ref.priceHistory.add({ supplierId: input.supplierId, productId: input.productId, productName: p.data()!.name, unitCost: input.unitCost, recordedAt: now });
  }
  if (input.preferred) await ref.products.doc(input.productId).update({ preferredSupplierId: input.supplierId, updatedAt: now });
}

export async function unlinkSupplierProduct(ctx: AppContext, linkId: string) {
  assertRole(ctx, "manager");
  if (!/^[A-Za-z0-9_-]{17,129}$/.test(linkId)) throw invalid("Invalid link.");
  await biz(ctx.business.id).supplierProducts.doc(linkId).delete();
}

export async function supplierDetail(businessId: string, supplierId: string) {
  const ref = biz(businessId);
  const [links, orders, history, products] = await Promise.all([
    ref.supplierProducts.where("supplierId", "==", supplierId).get(),
    ref.purchaseOrders.where("supplierId", "==", supplierId).get(),
    ref.priceHistory.where("supplierId", "==", supplierId).get(),
    loadProducts(businessId),
  ]);
  const byId = new Map(products.map((p) => [p.id, p]));
  return {
    links: links.docs.map((d) => ({ id: d.id, ...d.data(), product: byId.get(d.data().productId) ?? null })),
    orders: orders.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 20),
    history: history.docs.map((d) => d.data()).sort((a, b) => b.recordedAt.localeCompare(a.recordedAt)).slice(0, 30),
  };
}

// ── Reorder planning ────────────────────────────────────────────────────────
export async function loadReorderPlan(businessId: string) {
  const ref = biz(businessId);
  const [products, links, open] = await Promise.all([
    loadProducts(businessId),
    ref.supplierProducts.get(),
    ref.purchaseOrders.where("status", "in", ["draft", "approved", "sent", "partially_received"]).get(),
  ]);
  const suppliers = new Map((await listSuppliers(businessId)).map((s) => [s.id, s.name]));
  const linkKey = new Map(links.docs.map((d) => [d.id, d.data()]));
  const onOrder = new Set(open.docs.flatMap((d) => d.data().lines.map((l) => l.productId)));
  const candidates: ReorderCandidate[] = products
    .filter((p) => p.status !== "ok" && p.reorderThreshold > 0 && !onOrder.has(p.id))
    .map((p) => {
      const link = p.preferredSupplierId ? linkKey.get(`${p.preferredSupplierId}_${p.id}`) : undefined;
      return {
        productId: p.id, productName: p.name, unit: p.unit, currentQuantity: p.quantity, reorderThreshold: p.reorderThreshold,
        reorderQuantity: p.reorderQuantity, supplierId: p.preferredSupplierId && suppliers.has(p.preferredSupplierId) ? p.preferredSupplierId : null,
        supplierName: p.preferredSupplierId ? suppliers.get(p.preferredSupplierId) ?? null : null,
        unitCost: link ? link.unitCost : p.costPrice, packSize: link ? link.packSize : null,
      };
    });
  return { ...planDraftOrders(candidates), alreadyOnOrder: products.filter((p) => p.status !== "ok" && onOrder.has(p.id)).length };
}

// ── Purchase orders ─────────────────────────────────────────────────────────
export async function createPurchaseOrder(
  ctx: AppContext,
  input: { supplierId: string; items: { productId: string; quantity: number; unitCost: number }[]; notes: string | null; generatedByAi: boolean },
): Promise<string> {
  assertRole(ctx, "manager", "Only managers and owners can create purchase orders.");
  if (input.items.length === 0 || input.items.length > 200) throw invalid("Between 1 and 200 lines required.");
  const ref = biz(ctx.business.id);
  const supplier = await getSupplier(ctx.business.id, input.supplierId);
  if (!supplier || supplier.archivedAt) throw notFound("Supplier");
  const products = await db().getAll(...input.items.map((i) => ref.products.doc(i.productId)));
  const lines: PurchaseOrderLine[] = [];
  for (const [i, item] of input.items.entries()) {
    const p = products[i].data();
    if (!p) throw invalid("Unknown product on order.");
    if (!(item.quantity > 0 && item.quantity <= 1_000_000) || !(item.unitCost >= 0)) throw invalid("Invalid quantity or cost.");
    const existing = lines.find((l) => l.productId === item.productId);
    if (existing) existing.quantity += item.quantity;
    else lines.push({ id: newId(), productId: item.productId, productName: p.name, unit: p.unit, sku: p.sku, quantity: item.quantity, unitCost: round2(item.unitCost), receivedQuantity: 0 });
  }
  const id = newId();
  const now = nowIso();
  await db().runTransaction(async (tx) => {
    const counter = (await tx.get(ref.counters)).data()?.purchaseOrder ?? 0;
    tx.set(ref.counters, { purchaseOrder: counter + 1 }, { merge: true });
    tx.create(ref.purchaseOrders.doc(id), {
      poNumber: `PO-${String(counter + 1).padStart(5, "0")}`, supplierId: supplier.id, supplierName: supplier.name, status: "draft",
      notes: input.notes?.slice(0, 2000) ?? null, expectedDate: null, lines, subtotal: subtotal(lines), generatedByAi: input.generatedByAi,
      createdBy: ctx.userId, approvedBy: null, approvedAt: null, sentAt: null, sentVia: null, receipts: [], createdAt: now, updatedAt: now,
    });
  });
  await notify(ctx.business.id, { type: "po_pending", severity: "info", title: "Purchase order awaiting approval", body: `A draft order for ${supplier.name} is ready for your review.`, link: `/purchase-orders/${id}`, dedupeKey: `po_pending:${id}`, minRole: "owner" });
  await logActivity(ctx.business.id, ctx.userId, "purchase_order.created", "purchase_order", id);
  return id;
}

export async function listPurchaseOrders(businessId: string) {
  const snap = await biz(businessId).purchaseOrders.orderBy("createdAt", "desc").limit(100).get();
  return snap.docs.map((d) => ({ ...d.data(), id: d.id }));
}

export async function getPurchaseOrder(businessId: string, id: string) {
  if (!isDocId(id)) return null;
  const snap = await biz(businessId).purchaseOrders.doc(id).get();
  return snap.exists ? { ...snap.data()!, id } : null;
}

/** Edit draft lines/details. Anything but a draft is locked. */
export async function editDraft(ctx: AppContext, poId: string, edit: (po: PurchaseOrderDoc) => Partial<PurchaseOrderDoc>) {
  assertRole(ctx, "manager");
  const ref = biz(ctx.business.id).purchaseOrders.doc(poId);
  await db().runTransaction(async (tx) => {
    const po = (await tx.get(ref)).data();
    if (!po) throw notFound("Purchase order");
    if (po.status !== "draft") throw new AppError(409, "purchase_order_locked", "Only draft purchase orders can be edited.");
    const patch = edit(po);
    if (patch.lines) {
      if (patch.lines.length === 0) throw invalid("An order needs at least one line.");
      patch.subtotal = subtotal(patch.lines);
    }
    tx.update(ref, { ...patch, updatedAt: nowIso() });
  });
}

export async function addPoLine(ctx: AppContext, poId: string, productId: string) {
  const ref = biz(ctx.business.id);
  const p = (await ref.products.doc(productId).get()).data();
  if (!p) throw notFound("Product");
  const po = await getPurchaseOrder(ctx.business.id, poId);
  if (!po) throw notFound("Purchase order");
  const link = (await ref.supplierProducts.doc(`${po.supplierId}_${productId}`).get()).data();
  await editDraft(ctx, poId, (current) => {
    if (current.lines.some((l) => l.productId === productId)) throw new AppError(409, "duplicate", "That product is already on this order.");
    return { lines: [...current.lines, { id: newId(), productId, productName: p.name, unit: p.unit, sku: p.sku, quantity: link?.packSize ?? 1, unitCost: link?.unitCost ?? p.costPrice, receivedQuantity: 0 }] };
  });
}

export async function transitionPurchaseOrder(ctx: AppContext, poId: string, action: "approve" | "mark_sent" | "cancel", via?: "email" | "whatsapp" | "manual") {
  const ref = biz(ctx.business.id).purchaseOrders.doc(poId);
  if (!isDocId(poId)) throw notFound("Purchase order");
  await db().runTransaction(async (tx) => {
    const po = (await tx.get(ref)).data();
    if (!po) throw notFound("Purchase order");
    const now = nowIso();
    if (action === "approve") {
      assertRole(ctx, "owner", "Only the owner can approve purchase orders.");
      if (po.status !== "draft") throw new AppError(409, "invalid_transition", `Can't approve a ${po.status} order.`);
      tx.update(ref, { status: "approved", approvedBy: ctx.userId, approvedAt: now, updatedAt: now });
    } else if (action === "mark_sent") {
      assertRole(ctx, "manager");
      if (po.status !== "approved") throw new AppError(409, "invalid_transition", "Only approved orders can be sent.");
      if (!via) throw invalid("Choose how it was sent.");
      tx.update(ref, { status: "sent", sentAt: now, sentVia: via, updatedAt: now });
    } else {
      assertRole(ctx, po.status === "draft" ? "manager" : "owner");
      if (po.status === "received" || po.status === "cancelled") throw new AppError(409, "invalid_transition", `Order is already ${po.status}.`);
      tx.update(ref, { status: "cancelled", updatedAt: now });
    }
  });
  await logActivity(ctx.business.id, ctx.userId, `purchase_order.${action}`, "purchase_order", poId);
}

/** Receive goods against a line: stock movement and PO progress commit together. */
export async function receivePoLine(ctx: AppContext, poId: string, lineId: string, input: { quantity: number; batchNumber: string | null; expiryDate: string | null; key: string }): Promise<ApplyResult> {
  assertRole(ctx, "manager", "Only managers and owners can receive deliveries.");
  const ref = biz(ctx.business.id).purchaseOrders.doc(poId);
  const receiptKey = hashId(lineId, input.key);
  const result = await db().runTransaction(async (tx) => {
    const po = (await tx.get(ref)).data();
    if (!po) throw notFound("Purchase order");
    if (!["approved", "sent", "partially_received"].includes(po.status)) throw new AppError(409, "invalid_transition", `Can't receive against a ${po.status} order.`);
    const line = po.lines.find((l) => l.id === lineId);
    if (!line) throw notFound("Order line");
    if (!(input.quantity > 0) || line.receivedQuantity + input.quantity > line.quantity * 2) throw invalid("Receipt exceeds twice the ordered amount.");
    const applied = await applyMovementTx(tx, ctx.business.id, ctx.business, { userId: ctx.userId, name: ctx.fullName ?? ctx.email, role: ctx.role }, {
      productId: line.productId, type: "receive", quantity: input.quantity, source: "purchase", idempotencyKey: `po:${lineId}:${input.key}`,
      reason: `Received on ${po.poNumber}`, batchNumber: input.batchNumber, expiryDate: input.expiryDate, unitCost: line.unitCost,
      inputQuantity: input.quantity, externalRef: po.poNumber, approvedBy: { userId: ctx.userId, name: ctx.fullName },
    });
    if (!applied.duplicate && !po.receipts.includes(receiptKey)) {
      const lines = po.lines.map((l) => (l.id === lineId ? { ...l, receivedQuantity: l.receivedQuantity + input.quantity } : l));
      tx.update(ref, { lines, receipts: [...po.receipts, receiptKey].slice(-500), status: lines.every((l) => l.receivedQuantity >= l.quantity) ? "received" : "partially_received", updatedAt: nowIso() });
    }
    return applied;
  });
  if (!result.duplicate) await afterMovement(ctx.business.id, result);
  return result;
}
