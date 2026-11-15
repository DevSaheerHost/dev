import { ApiError, authedRoute } from "@/lib/api/handler";
import { csvResponse } from "@/lib/api/csv-response";
import { runReport } from "@/lib/data/reports";
import { REPORTS } from "@/lib/reports";

export const GET = authedRoute({ minRole: "manager", rateLimit: { name: "export", limit: 30, windowSeconds: 600 } }, async (request, ctx) => {
  const sp = request.nextUrl.searchParams;
  const type = sp.get("type") ?? "";
  if (!(type in REPORTS)) throw new ApiError(400, "invalid_input", "Choose a report.");
  const rows = await runReport(ctx, type, sp.get("from") ?? "", sp.get("to") ?? "");
  return csvResponse(`${type}-${sp.get("from")}-to-${sp.get("to")}.csv`, rows, REPORTS[type as keyof typeof REPORTS].columns.map((c) => c.key));
});
