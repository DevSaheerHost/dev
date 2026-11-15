import "server-only";
import type { AppContext } from "@/lib/auth/session";
import { planDraftOrders, type ReorderCandidate } from "@/lib/domain/reorder";

/** Builds the reorder plan from live stock, preferred suppliers and supplier prices. */
export async function loadReorderPlan(ctx: AppContext) {
  const { data: products, error } = await ctx.supabase
    .from("product_overview")
    .select("id, name, unit, current_quantity, reorder_threshold, reorder_quantity, cost_price, preferred_supplier_id, supplier_name, stock_status")
    .eq("business_id", ctx.business.id)
    .is("archived_at", null)
    .in("stock_status", ["low_stock", "out_of_stock"])
    .gt("reorder_threshold", 0)
    .limit(2000);
  if (error) throw error;
  const ids = (products ?? []).map((p) => p.id);
  const { data: prices } = ids.length
    ? await ctx.supabase.from("supplier_products").select("product_id, supplier_id, unit_cost, pack_size").in("product_id", ids)
    : { data: [] };
  const priceKey = new Map((prices ?? []).map((sp) => [`${sp.product_id}:${sp.supplier_id}`, sp]));

  const candidates: ReorderCandidate[] = (products ?? []).map((p) => {
    const sp = p.preferred_supplier_id ? priceKey.get(`${p.id}:${p.preferred_supplier_id}`) : undefined;
    return {
      productId: p.id, productName: p.name, unit: p.unit, currentQuantity: Number(p.current_quantity),
      reorderThreshold: Number(p.reorder_threshold), reorderQuantity: p.reorder_quantity === null ? null : Number(p.reorder_quantity),
      supplierId: p.preferred_supplier_id, supplierName: p.supplier_name,
      unitCost: sp ? Number(sp.unit_cost) : Number(p.cost_price), packSize: sp ? Number(sp.pack_size) : null,
    };
  });

  // Exclude products already on an open order so we don't double-order.
  const { data: open } = ids.length
    ? await ctx.supabase.from("purchase_order_items").select("product_id, purchase_orders!inner(status)").in("product_id", ids).in("purchase_orders.status", ["draft", "approved", "sent", "partially_received"])
    : { data: [] };
  const onOrder = new Set((open ?? []).map((o) => o.product_id));
  return { ...planDraftOrders(candidates.filter((c) => !onOrder.has(c.productId))), alreadyOnOrder: onOrder.size };
}
