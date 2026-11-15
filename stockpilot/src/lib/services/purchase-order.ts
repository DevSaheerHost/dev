import "server-only";
import type { AppContext } from "@/lib/auth/session";

export interface PurchaseOrderDetail {
  id: string; po_number: string; status: "draft" | "approved" | "sent" | "partially_received" | "received" | "cancelled";
  notes: string | null; expected_date: string | null; subtotal: number; created_at: string; approved_at: string | null; sent_at: string | null;
  sent_via: string | null; generated_by_ai: boolean;
  suppliers: { id: string; name: string; contact_person: string | null; email: string | null; phone: string | null; whatsapp_number: string | null; address: string | null; payment_terms: string | null };
  purchase_order_items: { id: string; quantity: number; unit_cost: number; received_quantity: number; line_total: number; products: { id: string; name: string; unit: string; sku: string | null } }[];
}

export async function loadPurchaseOrder(ctx: AppContext, id: string): Promise<PurchaseOrderDetail | null> {
  const { data } = await ctx.supabase
    .from("purchase_orders")
    .select("id, po_number, status, notes, expected_date, subtotal, created_at, approved_at, sent_at, sent_via, generated_by_ai, suppliers(id, name, contact_person, email, phone, whatsapp_number, address, payment_terms), purchase_order_items(id, quantity, unit_cost, received_quantity, line_total, products(id, name, unit, sku))")
    .eq("id", id)
    .eq("business_id", ctx.business.id)
    .maybeSingle();
  if (!data) return null;
  const po = data as unknown as PurchaseOrderDetail;
  po.purchase_order_items.sort((a, b) => a.products.name.localeCompare(b.products.name));
  return po;
}
