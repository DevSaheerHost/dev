import { NextResponse } from "next/server";
import { ApiError, authedRoute } from "@/lib/api/handler";
import { logActivity } from "@/lib/data/notify";
import { getAdapter } from "@/lib/integrations";
import { disconnect } from "@/lib/integrations/sync";

export const POST = authedRoute<{ provider: string }>({ minRole: "owner" }, async (_req, ctx, { provider }) => {
  const adapter = getAdapter(provider);
  if (!adapter) throw new ApiError(404, "not_found", "Unknown provider.");
  await disconnect(ctx.business.id, adapter.provider);
  await logActivity(ctx.business.id, ctx.userId, "integration.disconnected", "integration", null, { provider });
  return NextResponse.json({ ok: true });
});
