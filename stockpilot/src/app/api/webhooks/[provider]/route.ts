import { NextResponse, type NextRequest } from "next/server";
import { publicEnv } from "@/lib/env";
import { getAdapter } from "@/lib/integrations";
import { processWebhook } from "@/lib/integrations/sync";
import { IntegrationError } from "@/lib/integrations/types";

const MAX_BODY = 512 * 1024;

/**
 * POS webhooks. Signature is verified over the raw body BEFORE parsing;
 * events are de-duplicated by (provider, event id).
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  const adapter = getAdapter(provider);
  if (!adapter) return NextResponse.json({ error: "unknown provider" }, { status: 404 });
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY) return NextResponse.json({ error: "too large" }, { status: 413 });
  const rawBody = await request.text();
  if (rawBody.length > MAX_BODY) return NextResponse.json({ error: "too large" }, { status: 413 });

  // Clover's one-time setup ping arrives before the shared auth code exists.
  // It is logged for the owner to copy into CLOVER_WEBHOOK_AUTH_CODE and never processed.
  if (provider === "clover" && !request.headers.get("x-clover-auth")) {
    try {
      const ping = JSON.parse(rawBody) as { verificationCode?: unknown };
      if (typeof ping.verificationCode === "string" && /^[A-Za-z0-9-]{8,100}$/.test(ping.verificationCode)) {
        console.info("Clover webhook verification code received:", ping.verificationCode);
        return NextResponse.json({ ok: true });
      }
    } catch {}
  }

  const url = `${publicEnv().NEXT_PUBLIC_APP_URL}/api/webhooks/${provider}`;
  if (!adapter.verifyWebhook({ rawBody, headers: request.headers, url })) {
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }
  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  try {
    const result = await processWebhook(adapter.provider, body, request.headers);
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    // 5xx makes the provider retry; malformed events are acknowledged to stop retries.
    const retryable = e instanceof IntegrationError ? e.retryable : true;
    return NextResponse.json({ error: "processing failed" }, { status: retryable ? 503 : 422 });
  }
}
