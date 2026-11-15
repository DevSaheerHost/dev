"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { hasRole, requireContext } from "@/lib/auth/session";
import { dbFailure, isoDateOrNull, optionalText, type ActionResult } from "@/lib/actions";
import { buildOrderMessage } from "@/lib/domain/purchase-order-message";
import { sendEmail, sendWhatsApp } from "@/lib/services/channels";
import { loadReorderPlan } from "@/lib/services/reorder";

async function ctxWithRole(min: "manager" | "owner") {
  const ctx = await requireContext();
  return hasRole(ctx.role, min) ? ctx : null;
}

export async function generateDraftOrders(): Promise<ActionResult<{ created: number }>> {
  const ctx = await ctxWithRole("manager");
  if (!ctx) return { ok: false, error: "Only managers and owners can create purchase orders." };
  const plan = await loadReorderPlan(ctx);
  let created = 0;
  for (const order of plan.orders) {
    const { error } = await ctx.supabase.rpc("create_purchase_order", {
      p_business_id: ctx.business.id,
      p_supplier_id: order.supplierId,
      p_items: order.lines.map((l) => ({ product_id: l.productId, quantity: l.quantity, unit_cost: l.unitCost })),
      p_notes: "Generated from low-stock alerts",
      p_expected_date: null,
      p_generated_by_ai: true,
    });
    if (error) return { ok: false, error: `Created ${created}, then failed: ${dbFailure(error).error}` };
    created++;
  }
  revalidatePath("/purchase-orders");
  return { ok: true, data: { created }, message: created ? `${created} draft ${created === 1 ? "order" : "orders"} created for approval.` : "Nothing needs reordering." };
}

export async function createManualOrder(supplierId: string): Promise<ActionResult<{ id: string }>> {
  const ctx = await ctxWithRole("manager");
  if (!ctx || !z.uuid().safeParse(supplierId).success) return { ok: false, error: "Not allowed." };
  const { data: first } = await ctx.supabase.from("supplier_products").select("product_id, unit_cost, pack_size").eq("supplier_id", supplierId).limit(1).maybeSingle();
  if (!first) return { ok: false, error: "Link at least one product to this supplier first." };
  const { data, error } = await ctx.supabase.rpc("create_purchase_order", {
    p_business_id: ctx.business.id, p_supplier_id: supplierId,
    p_items: [{ product_id: first.product_id, quantity: Number(first.pack_size) || 1, unit_cost: Number(first.unit_cost) }],
    p_notes: null, p_expected_date: null, p_generated_by_ai: false,
  });
  if (error || !data) return dbFailure(error);
  revalidatePath("/purchase-orders");
  return { ok: true, data: { id: data as string } };
}

const lineSchema = z.object({ poId: z.uuid(), itemId: z.uuid(), quantity: z.coerce.number().positive().max(1_000_000), unitCost: z.coerce.number().min(0).max(1_000_000) });

export async function updateLine(input: z.input<typeof lineSchema>): Promise<ActionResult> {
  const ctx = await ctxWithRole("manager");
  const parsed = lineSchema.safeParse(input);
  if (!ctx || !parsed.success) return { ok: false, error: "Invalid line." };
  const { error } = await ctx.supabase.from("purchase_order_items").update({ quantity: parsed.data.quantity, unit_cost: parsed.data.unitCost }).eq("id", parsed.data.itemId).eq("business_id", ctx.business.id);
  if (error) return dbFailure(error);
  revalidatePath(`/purchase-orders/${parsed.data.poId}`);
  return { ok: true };
}

export async function addLine(poId: string, productId: string): Promise<ActionResult> {
  const ctx = await ctxWithRole("manager");
  if (!ctx || !z.uuid().safeParse(poId).success || !z.uuid().safeParse(productId).success) return { ok: false, error: "Invalid line." };
  const { data: po } = await ctx.supabase.from("purchase_orders").select("supplier_id").eq("id", poId).maybeSingle();
  const { data: sp } = po ? await ctx.supabase.from("supplier_products").select("unit_cost, pack_size").eq("supplier_id", po.supplier_id).eq("product_id", productId).maybeSingle() : { data: null };
  const { data: product } = await ctx.supabase.from("products").select("cost_price").eq("id", productId).maybeSingle();
  const { error } = await ctx.supabase.from("purchase_order_items").insert({
    business_id: ctx.business.id, purchase_order_id: poId, product_id: productId,
    quantity: sp ? Number(sp.pack_size) : 1, unit_cost: sp ? Number(sp.unit_cost) : Number(product?.cost_price ?? 0),
  });
  if (error) return dbFailure(error);
  revalidatePath(`/purchase-orders/${poId}`);
  return { ok: true };
}

export async function removeLine(poId: string, itemId: string): Promise<ActionResult> {
  const ctx = await ctxWithRole("manager");
  if (!ctx || !z.uuid().safeParse(itemId).success) return { ok: false, error: "Invalid line." };
  const { error } = await ctx.supabase.from("purchase_order_items").delete().eq("id", itemId).eq("business_id", ctx.business.id);
  if (error) return dbFailure(error);
  revalidatePath(`/purchase-orders/${poId}`);
  return { ok: true };
}

export async function updateOrderDetails(poId: string, notes: string, expectedDate: string): Promise<ActionResult> {
  const ctx = await ctxWithRole("manager");
  const parsed = z.object({ notes: optionalText(2000), expectedDate: isoDateOrNull }).safeParse({ notes, expectedDate });
  if (!ctx || !parsed.success || !z.uuid().safeParse(poId).success) return { ok: false, error: "Invalid details." };
  const { error } = await ctx.supabase.from("purchase_orders").update({ notes: parsed.data.notes, expected_date: parsed.data.expectedDate }).eq("id", poId).eq("business_id", ctx.business.id);
  if (error) return dbFailure(error);
  revalidatePath(`/purchase-orders/${poId}`);
  return { ok: true };
}

export async function transitionOrder(poId: string, action: "approve" | "cancel" | "mark_sent", via?: "email" | "whatsapp" | "manual"): Promise<ActionResult> {
  const ctx = await requireContext();
  if (!z.uuid().safeParse(poId).success) return { ok: false, error: "Invalid order." };
  const { error } = await ctx.supabase.rpc("transition_purchase_order", { p_po_id: poId, p_action: action, p_sent_via: via ?? null });
  if (error) return dbFailure(error);
  revalidatePath(`/purchase-orders/${poId}`);
  revalidatePath("/purchase-orders");
  return { ok: true, message: action === "approve" ? "Order approved." : action === "cancel" ? "Order cancelled." : "Marked as sent." };
}

/** Sends an APPROVED order to the supplier. The database refuses unapproved orders. */
export async function sendOrder(poId: string, channel: "email" | "whatsapp"): Promise<ActionResult> {
  const ctx = await ctxWithRole("manager");
  if (!ctx || !z.uuid().safeParse(poId).success) return { ok: false, error: "Not allowed." };
  const { data: po } = await ctx.supabase
    .from("purchase_orders")
    .select("id, po_number, status, notes, expected_date, suppliers(name, contact_person, email, whatsapp_number), purchase_order_items(quantity, products(name, unit))")
    .eq("id", poId)
    .eq("business_id", ctx.business.id)
    .maybeSingle();
  if (!po) return { ok: false, error: "Order not found." };
  if (po.status !== "approved") return { ok: false, error: "Only approved orders can be sent. The owner must approve it first." };
  const supplier = po.suppliers as unknown as { name: string; contact_person: string | null; email: string | null; whatsapp_number: string | null };
  const msg = buildOrderMessage({
    businessName: ctx.business.name, poNumber: po.po_number, supplierName: supplier.name, contactPerson: supplier.contact_person,
    expectedDate: po.expected_date, notes: po.notes,
    lines: (po.purchase_order_items as unknown as { quantity: number; products: { name: string; unit: string } }[]).map((l) => ({ productName: l.products.name, quantity: Number(l.quantity), unit: l.products.unit })),
  });
  const result =
    channel === "email"
      ? supplier.email ? await sendEmail(supplier.email, msg.subject, msg.body) : { sent: false as const, reason: "This supplier has no email address." }
      : supplier.whatsapp_number ? await sendWhatsApp(supplier.whatsapp_number, `${msg.subject}\n\n${msg.body}`) : { sent: false as const, reason: "This supplier has no WhatsApp number." };
  if (!result.sent) return { ok: false, error: `${result.reason} You can still send it yourself using the prepared message, then mark it as sent.` };
  const { error } = await ctx.supabase.rpc("transition_purchase_order", { p_po_id: poId, p_action: "mark_sent", p_sent_via: channel });
  if (error) return dbFailure(error);
  revalidatePath(`/purchase-orders/${poId}`);
  return { ok: true, message: `Sent to ${supplier.name} by ${channel}.` };
}

const receiveSchema = z.object({
  poId: z.uuid(), itemId: z.uuid(), quantity: z.coerce.number().positive().max(1_000_000),
  batchNumber: optionalText(64), expiryDate: isoDateOrNull, key: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/),
});

export async function receiveLine(input: z.input<typeof receiveSchema>): Promise<ActionResult> {
  const ctx = await ctxWithRole("manager");
  const parsed = receiveSchema.safeParse(input);
  if (!ctx) return { ok: false, error: "Only managers and owners can receive deliveries." };
  if (!parsed.success) return { ok: false, error: "Check the quantity and dates." };
  const r = parsed.data;
  const { error } = await ctx.supabase.rpc("receive_purchase_order_item", {
    p_item_id: r.itemId, p_quantity: r.quantity, p_idempotency_key: r.key, p_batch_number: r.batchNumber, p_expiry_date: r.expiryDate,
  });
  if (error) return dbFailure(error);
  revalidatePath(`/purchase-orders/${r.poId}`);
  return { ok: true, message: "Delivery recorded and stock updated." };
}
