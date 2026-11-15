import { authedRoute } from "@/lib/api/handler";
import { csvResponse } from "@/lib/api/csv-response";
import { biz } from "@/lib/data/refs";

export const GET = authedRoute({ minRole: "manager", rateLimit: { name: "export", limit: 30, windowSeconds: 600 } }, async (request, ctx) => {
  const sp = request.nextUrl.searchParams;
  const isDate = (v: string | null): v is string => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);
  const from = isDate(sp.get("from")) ? sp.get("from")! : new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
  const to = isDate(sp.get("to")) ? sp.get("to")! : new Date().toISOString().slice(0, 10);
  const end = new Date(Date.parse(`${to}T00:00:00Z`) + 86_400_000).toISOString();
  const snap = await biz(ctx.business.id).movements.where("createdAt", ">=", `${from}T00:00:00.000Z`).where("createdAt", "<", end).orderBy("createdAt", "desc").limit(50_000).get();
  const rows = snap.docs.map((d) => {
    const m = d.data();
    return {
      date: m.createdAt, product: m.productName, unit: m.unit, type: m.type, source: m.source, before: m.quantityBefore, change: m.quantityChange,
      after: m.quantityAfter, said_quantity: m.inputQuantity, said_unit: m.inputUnit, unit_cost: m.unitCost, value_change: m.valueChange,
      reason: m.reason, ai_confidence: m.aiConfidence, approved_by: m.approvedByName, reference: m.externalRef,
      by: m.actorName ?? (m.source === "pos" ? "POS" : "System"),
    };
  });
  return csvResponse(`movements-${from}-to-${to}.csv`, rows);
});
