"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireContext } from "@/lib/auth/session";
import { attempt, failure, isoDateOrNull, optionalText, type ActionResult } from "@/lib/actions";
import * as purchasing from "@/lib/data/purchasing";
import { buildOrderMessage } from "@/lib/domain/purchase-order-message";
import { forbidden, invalid } from "@/lib/errors";
import { sendEmail, sendWhatsApp } from "@/lib/services/channels";

const docId = z.string().regex(/^[A-Za-z0-9_-]{8,64}$/);

export async function generateDraftOrders(): Promise<ActionResult<{ created: number }>> {
  const ctx = await requireContext();
  if (ctx.role === "employee") return failure(forbidden("Only managers and owners can create purchase orders."));
  const plan = await purchasing.loadReorderPlan(ctx.business.id);
  let created = 0;
  for (const order of plan.orders) {
    const r = await attempt(() => purchasing.createPurchaseOrder(ctx, { supplierId: order.supplierId, items: order.lines.map((l) => ({ productId: l.productId, quantity: l.quantity, unitCost: l.unitCost })), notes: "Generated from low-stock alerts", generatedByAi: true }));
    if (!r.ok) return { ok: false, error: `Created ${created}, then failed: ${r.error}` };
    created++;
  }
  revalidatePath("/purchase-orders");
  return { ok: true, data: { created }, message: created ? `${created} draft ${created === 1 ? "order" : "orders"} created for approval.` : "Nothing needs reordering." };
}

export async function createManualOrder(supplierId: string): Promise<ActionResult<{ id: string }>> {
  const ctx = await requireContext();
  return attempt(async () => {
    if (!docId.safeParse(supplierId).success) throw invalid("Choose a supplier.");
    const { links } = await purchasing.supplierDetail(ctx.business.id, supplierId);
    const first = links.find((l) => l.product);
    if (!first) throw invalid("Link at least one product to this supplier first.");
    const id = await purchasing.createPurchaseOrder(ctx, { supplierId, items: [{ productId: first.productId, quantity: first.packSize || 1, unitCost: first.unitCost }], notes: null, generatedByAi: false });
    revalidatePath("/purchase-orders");
    return { id };
  });
}

const lineSchema = z.object({ poId: docId, itemId: docId, quantity: z.coerce.number().positive().max(1_000_000), unitCost: z.coerce.number().min(0).max(1_000_000) });

export async function updateLine(input: z.input<typeof lineSchema>): Promise<ActionResult> {
  const ctx = await requireContext();
  const parsed = lineSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid line." };
  const { poId, itemId, quantity, unitCost } = parsed.data;
  const r = await attempt(() => purchasing.editDraft(ctx, poId, (po) => ({ lines: po.lines.map((l) => (l.id === itemId ? { ...l, quantity, unitCost: Math.round(unitCost * 100) / 100 } : l)) })));
  revalidatePath(`/purchase-orders/${poId}`);
  return r;
}

export async function addLine(poId: string, productId: string): Promise<ActionResult> {
  const ctx = await requireContext();
  if (!docId.safeParse(poId).success || !docId.safeParse(productId).success) return { ok: false, error: "Invalid line." };
  const r = await attempt(() => purchasing.addPoLine(ctx, poId, productId));
  revalidatePath(`/purchase-orders/${poId}`);
  return r;
}

export async function removeLine(poId: string, itemId: string): Promise<ActionResult> {
  const ctx = await requireContext();
  if (!docId.safeParse(poId).success) return { ok: false, error: "Invalid line." };
  const r = await attempt(() => purchasing.editDraft(ctx, poId, (po) => ({ lines: po.lines.filter((l) => l.id !== itemId) })));
  revalidatePath(`/purchase-orders/${poId}`);
  return r;
}

export async function updateOrderDetails(poId: string, notes: string, expectedDate: string): Promise<ActionResult> {
  const ctx = await requireContext();
  const parsed = z.object({ notes: optionalText(2000), expectedDate: isoDateOrNull }).safeParse({ notes, expectedDate });
  if (!parsed.success || !docId.safeParse(poId).success) return { ok: false, error: "Invalid details." };
  const r = await attempt(() => purchasing.editDraft(ctx, poId, () => ({ notes: parsed.data.notes, expectedDate: parsed.data.expectedDate })));
  revalidatePath(`/purchase-orders/${poId}`);
  return r;
}

export async function transitionOrder(poId: string, action: "approve" | "cancel" | "mark_sent", via?: "email" | "whatsapp" | "manual"): Promise<ActionResult> {
  const ctx = await requireContext();
  if (!["approve", "cancel", "mark_sent"].includes(action)) return { ok: false, error: "Invalid action." };
  const r = await attempt(() => purchasing.transitionPurchaseOrder(ctx, poId, action, via), action === "approve" ? "Order approved." : action === "cancel" ? "Order cancelled." : "Marked as sent.");
  revalidatePath(`/purchase-orders/${poId}`);
  revalidatePath("/purchase-orders");
  return r;
}

/** Sends an APPROVED order to the supplier; unapproved orders are refused. */
export async function sendOrder(poId: string, channel: "email" | "whatsapp"): Promise<ActionResult> {
  const ctx = await requireContext();
  const po = await purchasing.getPurchaseOrder(ctx.business.id, poId);
  if (!po || ctx.role === "employee") return { ok: false, error: "Not allowed." };
  if (po.status !== "approved") return { ok: false, error: "Only approved orders can be sent. The owner must approve it first." };
  const supplier = await purchasing.getSupplier(ctx.business.id, po.supplierId);
  if (!supplier) return { ok: false, error: "Supplier not found." };
  const msg = buildOrderMessage({
    businessName: ctx.business.name, poNumber: po.poNumber, supplierName: supplier.name, contactPerson: supplier.contactPerson,
    expectedDate: po.expectedDate, notes: po.notes, lines: po.lines.map((l) => ({ productName: l.productName, quantity: l.quantity, unit: l.unit })),
  });
  const result =
    channel === "email"
      ? supplier.email ? await sendEmail(supplier.email, msg.subject, msg.body) : { sent: false as const, reason: "This supplier has no email address." }
      : supplier.whatsappNumber ? await sendWhatsApp(supplier.whatsappNumber, `${msg.subject}\n\n${msg.body}`) : { sent: false as const, reason: "This supplier has no WhatsApp number." };
  if (!result.sent) return { ok: false, error: `${result.reason} You can still send it yourself using the prepared message, then mark it as sent.` };
  const r = await attempt(() => purchasing.transitionPurchaseOrder(ctx, poId, "mark_sent", channel), `Sent to ${supplier.name} by ${channel}.`);
  revalidatePath(`/purchase-orders/${poId}`);
  return r;
}

const receiveSchema = z.object({
  poId: docId, itemId: docId, quantity: z.coerce.number().positive().max(1_000_000),
  batchNumber: optionalText(64), expiryDate: isoDateOrNull, key: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/),
});

export async function receiveLine(input: z.input<typeof receiveSchema>): Promise<ActionResult> {
  const ctx = await requireContext();
  const parsed = receiveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Check the quantity and dates." };
  const r = parsed.data;
  if (ctx.role === "employee") return failure(forbidden("Only managers and owners can receive deliveries."));
  const res = await attempt(async () => void (await purchasing.receivePoLine(ctx, r.poId, r.itemId, { quantity: r.quantity, batchNumber: r.batchNumber, expiryDate: r.expiryDate, key: r.key })), "Delivery recorded and stock updated.");
  revalidatePath(`/purchase-orders/${r.poId}`);
  return res;
}
