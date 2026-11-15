import { NextResponse, type NextRequest } from "next/server";
import { resolveContext } from "@/lib/auth/session";
import { logActivity } from "@/lib/data/notify";
import { oauthStates } from "@/lib/data/refs";
import { publicEnv } from "@/lib/env";
import { db } from "@/lib/firebase/admin";
import { getAdapter } from "@/lib/integrations";
import { runPullSync, saveConnection } from "@/lib/integrations/sync";
import { IntegrationError } from "@/lib/integrations/types";
import { sha256Hex } from "@/lib/security/crypto";

/** OAuth redirect target. The single-use state must belong to the signed-in user, who must still be an owner. */
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

  const stateRef = oauthStates().doc(sha256Hex(state));
  const saved = await db().runTransaction(async (tx) => {
    const s = (await tx.get(stateRef)).data();
    if (s) tx.delete(stateRef); // single use
    return s;
  });
  if (!saved || saved.provider !== provider || saved.userId !== ctx.context.userId || Date.parse(saved.expiresAt) < Date.now()) {
    return back("error=This+connection+link+expired.+Please+try+again.");
  }
  if (!ctx.context.memberships.some((m) => m.businessId === saved.businessId && m.role === "owner")) return back("error=Only+an+owner+can+connect+integrations.");
  const shop = provider === "shopify" ? sp.get("shop") ?? undefined : undefined;
  if (provider === "shopify" && saved.shopDomain && shop !== saved.shopDomain) return back("error=Shop+mismatch");

  try {
    const creds = await adapter.exchangeCode({ code, redirectUri: `${publicEnv().NEXT_PUBLIC_APP_URL}/api/integrations/${provider}/callback`, shop, query: sp });
    await saveConnection(saved.businessId, adapter.provider, ctx.context.userId, creds);
    if (adapter.registerWebhooks) {
      await adapter.registerWebhooks(creds, `${publicEnv().NEXT_PUBLIC_APP_URL}/api/webhooks/${provider}`).catch((e) => console.error("Webhook registration failed", e));
    }
    await logActivity(saved.businessId, ctx.context.userId, "integration.connected", "integration", null, { provider });
    void runPullSync(saved.businessId, adapter.provider, ctx.context.userId).catch(() => {});
    return back(`connected=${provider}`);
  } catch (e) {
    return back(`error=${encodeURIComponent(e instanceof IntegrationError ? e.message : "Connection failed.")}`);
  }
}
