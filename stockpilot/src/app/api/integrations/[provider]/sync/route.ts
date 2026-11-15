import { NextResponse } from "next/server";
import { ApiError, authedRoute } from "@/lib/api/handler";
import { getAdapter } from "@/lib/integrations";
import { runPullSync } from "@/lib/integrations/sync";
import { IntegrationError } from "@/lib/integrations/types";

export const maxDuration = 60;

/** Manual synchronization (managers). */
export const POST = authedRoute<{ provider: string }>({ minRole: "manager", rateLimit: { name: "pos-sync", limit: 6, windowSeconds: 600 } }, async (_req, ctx, { provider }) => {
  const adapter = getAdapter(provider);
  if (!adapter) throw new ApiError(404, "not_found", "Unknown provider.");
  try {
    return NextResponse.json({ summary: await runPullSync(ctx.business.id, adapter.provider, ctx.userId) });
  } catch (e) {
    throw new ApiError(502, "sync_failed", e instanceof IntegrationError ? e.message : "Sync failed.");
  }
});
