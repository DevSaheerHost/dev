import { ApiError, authedRoute, fromDbError } from "@/lib/api/handler";
import { csvResponse } from "@/lib/api/csv-response";
import { REPORTS } from "@/lib/reports";

export const GET = authedRoute({ minRole: "manager", rateLimit: { name: "export", limit: 30, windowSeconds: 600 } }, async (request, ctx) => {
  const sp = request.nextUrl.searchParams;
  const type = sp.get("type") ?? "";
  const from = sp.get("from") ?? "";
  const to = sp.get("to") ?? "";
  if (!(type in REPORTS) || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    throw new ApiError(400, "invalid_input", "Choose a report and a valid date range.");
  }
  const { data, error } = await ctx.supabase.rpc("inventory_report", { p_business_id: ctx.business.id, p_report: type, p_from: from, p_to: to });
  if (error) throw fromDbError(error);
  const report = REPORTS[type as keyof typeof REPORTS];
  return csvResponse(`${type}-${from}-to-${to}.csv`, (data ?? []) as Record<string, unknown>[], report.columns.map((c) => c.key));
});
