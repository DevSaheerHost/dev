import { authedRoute, fromDbError } from "@/lib/api/handler";
import { csvResponse } from "@/lib/api/csv-response";

export const GET = authedRoute({ minRole: "manager", rateLimit: { name: "export", limit: 30, windowSeconds: 600 } }, async (request, ctx) => {
  const sp = request.nextUrl.searchParams;
  const from = /^\d{4}-\d{2}-\d{2}$/.test(sp.get("from") ?? "") ? sp.get("from")! : new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10);
  const to = /^\d{4}-\d{2}-\d{2}$/.test(sp.get("to") ?? "") ? sp.get("to")! : new Date().toISOString().slice(0, 10);
  const { data, error } = await ctx.supabase
    .from("inventory_movements")
    .select("created_at, movement_type, source, quantity_before, quantity_change, quantity_after, input_quantity, input_unit, unit_cost, value_change, reason, ai_confidence, approval_status, external_ref, actor_id, products(name, sku, unit)")
    .eq("business_id", ctx.business.id)
    .gte("created_at", `${from}T00:00:00Z`)
    .lt("created_at", `${to}T23:59:59.999Z`)
    .order("created_at", { ascending: false })
    .limit(50000);
  if (error) throw fromDbError(error);
  const actorIds = [...new Set((data ?? []).map((m) => m.actor_id).filter(Boolean))] as string[];
  const { data: people } = actorIds.length ? await ctx.supabase.from("profiles").select("id, full_name, email").in("id", actorIds) : { data: [] };
  const names = new Map((people ?? []).map((p) => [p.id, p.full_name || p.email]));
  const rows = (data ?? []).map((m) => {
    const product = m.products as unknown as { name: string; sku: string | null; unit: string } | null;
    return {
      date: m.created_at, product: product?.name, sku: product?.sku, unit: product?.unit, type: m.movement_type, source: m.source,
      before: m.quantity_before, change: m.quantity_change, after: m.quantity_after, said_quantity: m.input_quantity, said_unit: m.input_unit,
      unit_cost: m.unit_cost, value_change: m.value_change, reason: m.reason, ai_confidence: m.ai_confidence, approval: m.approval_status,
      reference: m.external_ref, by: m.actor_id ? names.get(m.actor_id) ?? "" : m.source === "pos" ? "POS" : "System",
    };
  });
  return csvResponse(`movements-${from}-to-${to}.csv`, rows);
});
