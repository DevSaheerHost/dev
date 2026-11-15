import { authedRoute, fromDbError } from "@/lib/api/handler";
import { csvResponse } from "@/lib/api/csv-response";
import { hasRole } from "@/lib/auth/session";

export const GET = authedRoute({ rateLimit: { name: "export", limit: 30, windowSeconds: 600 } }, async (_req, ctx) => {
  const { data, error } = await ctx.supabase
    .from("product_overview")
    .select("name, sku, barcode, brand, category, unit, current_quantity, reorder_threshold, reorder_quantity, cost_price, selling_price, storage_location, supplier_name, stock_status, next_expiry")
    .eq("business_id", ctx.business.id)
    .is("archived_at", null)
    .order("name")
    .limit(20000);
  if (error) throw fromDbError(error);
  const rows = (data ?? []).map((r) => {
    const { cost_price, ...rest } = r as Record<string, unknown>;
    return hasRole(ctx.role, "manager") ? { ...rest, cost_price } : rest;
  });
  return csvResponse(`inventory-${new Date().toISOString().slice(0, 10)}.csv`, rows);
});
