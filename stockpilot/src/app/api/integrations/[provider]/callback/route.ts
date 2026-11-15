import { NextResponse, type NextRequest } from "next/server";
import { resolveContext } from "@/lib/auth/session";
import { publicEnv } from "@/lib/env";
import { getAdapter } from "@/lib/integrations";
import { runPullSync, saveCredentials } from "@/lib/integrations/sync";
import { IntegrationError } from "@/lib/integrations/types";
import { sha256Hex } from "@/lib/security/crypto";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/** OAuth redirect target. Verifies the single-use state belongs to the signed-in owner. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  const back = (q: string) => NextResponse.redirect(new URL(`/integrations?${q}`, request.url));
  const adapter = getAdapter(provider);
  const sp = request.nextUrl.searchParams;
  const state = sp.get("state");
  const code = sp.get("code");
  if (!adapter || !state || !code || state.length > 100 || code.length > 2000) return back("error=Invalid+response+from+provider");

  const ctx = await resolveContext();
  if (ctx.status !== "ok") return NextResponse.redirect(new URL("/login", request.url));

  const admin = createSupabaseAdminClient();
  const { data: saved } = await admin.from("integration_oauth_states").delete().eq("state_hash", sha256Hex(state)).select("*").maybeSingle();
  if (!saved || saved.provider !== provider || saved.user_id !== ctx.context.userId || Date.parse(saved.expires_at) < Date.now()) {
    return back("error=This+connection+link+expired.+Please+try+again.");
  }
  // Re-check authority at completion time, not just when the flow started.
  if (!ctx.context.memberships.some((m) => m.businessId === saved.business_id && m.role === "owner")) {
    return back("error=Only+an+owner+can+connect+integrations.");
  }
  const shop = provider === "shopify" ? sp.get("shop") ?? undefined : undefined;
  if (provider === "shopify" && saved.shop_domain && shop !== saved.shop_domain) return back("error=Shop+mismatch");

  try {
    const creds = await adapter.exchangeCode({ code, redirectUri: `${publicEnv().NEXT_PUBLIC_APP_URL}/api/integrations/${provider}/callback`, shop, query: sp });
    const { data: integration, error } = await admin
      .from("integrations")
      .upsert(
        { business_id: saved.business_id, provider, status: "connected", external_account_id: creds.accountId, shop_domain: creds.shopDomain ?? null, connected_by: ctx.context.userId, last_error: null },
        { onConflict: "business_id,provider" },
      )
      .select("id")
      .single();
    if (error || !integration) throw new IntegrationError("Couldn't save the integration.");
    await saveCredentials(admin, integration.id, saved.business_id, creds);
    if (adapter.registerWebhooks) {
      await adapter.registerWebhooks(creds, `${publicEnv().NEXT_PUBLIC_APP_URL}/api/webhooks/${provider}`).catch((e) => console.error("Webhook registration failed", e));
    }
    await admin.from("activity_logs").insert({ business_id: saved.business_id, actor_id: ctx.context.userId, action: "integration.connected", entity_type: "integration", entity_id: integration.id, metadata: { provider } });
    void runPullSync(integration.id, ctx.context.userId).catch(() => {});
    return back(`connected=${provider}`);
  } catch (e) {
    return back(`error=${encodeURIComponent(e instanceof IntegrationError ? e.message : "Connection failed.")}`);
  }
}
