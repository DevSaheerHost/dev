import { NextResponse } from "next/server";
import { ApiError, authedRoute } from "@/lib/api/handler";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const POST = authedRoute<{ provider: string }>({ minRole: "owner" }, async (_req, ctx, { provider }) => {
  const admin = createSupabaseAdminClient();
  const { data: integration } = await admin.from("integrations").select("id").eq("business_id", ctx.business.id).eq("provider", provider).maybeSingle();
  if (!integration) throw new ApiError(404, "not_found", "Not connected.");
  await admin.from("integration_credentials").delete().eq("integration_id", integration.id);
  await admin.from("integrations").update({ status: "disconnected", external_account_id: null }).eq("id", integration.id);
  await admin.from("activity_logs").insert({ business_id: ctx.business.id, actor_id: ctx.userId, action: "integration.disconnected", entity_type: "integration", entity_id: integration.id, metadata: { provider } });
  return NextResponse.json({ ok: true });
});
