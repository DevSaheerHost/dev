import { NextResponse } from "next/server";
import { ApiError, authedRoute } from "@/lib/api/handler";
import { runPullSync } from "@/lib/integrations/sync";
import { IntegrationError } from "@/lib/integrations/types";

export const maxDuration = 60;

/** Manual synchronization (managers). */
export const POST = authedRoute<{ provider: string }>({ minRole: "manager", rateLimit: { name: "pos-sync", limit: 6, windowSeconds: 600 } }, async (_req, ctx, { provider }) => {
  const { data: integration } = await ctx.supabase.from("integrations").select("id, status").eq("business_id", ctx.business.id).eq("provider", provider).maybeSingle();
  if (!integration || integration.status === "not_connected" || integration.status === "disconnected") throw new ApiError(404, "not_connected", "This integration isn't connected.");
  try {
    const summary = await runPullSync(integration.id, ctx.userId);
    return NextResponse.json({ summary });
  } catch (e) {
    throw new ApiError(502, "sync_failed", e instanceof IntegrationError ? e.message : "Sync failed.");
  }
});
