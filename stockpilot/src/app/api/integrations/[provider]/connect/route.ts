import { NextResponse, type NextRequest } from "next/server";
import { jsonError, requireApiContext } from "@/lib/api/handler";
import { publicEnv, serverEnv } from "@/lib/env";
import { getAdapter } from "@/lib/integrations";
import { IntegrationError } from "@/lib/integrations/types";
import { randomToken, sha256Hex } from "@/lib/security/crypto";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/** Starts OAuth for a POS provider (owner only). State is single-use and bound to the user. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ provider: string }> }) {
  try {
    const { provider } = await params;
    const adapter = getAdapter(provider);
    const back = (msg: string) => NextResponse.redirect(new URL(`/integrations?error=${encodeURIComponent(msg)}`, request.url));
    if (!adapter) return back("Unknown provider.");
    const ctx = await requireApiContext("owner");
    if (!adapter.configured()) return back(`${adapter.label} isn't configured on this server yet.`);
    if (!serverEnv().INTEGRATION_ENCRYPTION_KEY) return back("INTEGRATION_ENCRYPTION_KEY must be set before connecting a POS.");
    const shop = request.nextUrl.searchParams.get("shop")?.trim().toLowerCase() ?? undefined;

    const state = randomToken(24);
    const { error } = await createSupabaseAdminClient().from("integration_oauth_states").insert({
      state_hash: sha256Hex(state), business_id: ctx.business.id, provider, user_id: ctx.userId, shop_domain: shop ?? null,
    });
    if (error) return back("Couldn't start the connection. Please try again.");
    const redirectUri = `${publicEnv().NEXT_PUBLIC_APP_URL}/api/integrations/${provider}/callback`;
    try {
      return NextResponse.redirect(adapter.authorizeUrl({ state, redirectUri, shop }));
    } catch (e) {
      return back(e instanceof IntegrationError ? e.message : "Couldn't start the connection.");
    }
  } catch (e) {
    return jsonError(e);
  }
}
