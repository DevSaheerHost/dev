import { NextResponse, type NextRequest } from "next/server";
import { serverEnv } from "@/lib/env";
import { runPullSync } from "@/lib/integrations/sync";
import { safeEqual } from "@/lib/security/crypto";
import { dispatchNotifications } from "@/lib/services/dispatch";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 300;

/**
 * Scheduled maintenance (Vercel Cron sends `Authorization: Bearer $CRON_SECRET`):
 * expiry alerts, failed-sync retries and notification delivery.
 */
export async function GET(request: NextRequest) {
  const secret = serverEnv().CRON_SECRET;
  const auth = request.headers.get("authorization") ?? "";
  if (!secret || !safeEqual(auth, `Bearer ${secret}`)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const admin = createSupabaseAdminClient();
  const result: Record<string, unknown> = {};

  const { data: alerts, error } = await admin.rpc("run_expiry_alerts");
  result.expiryAlerts = error ? `failed: ${error.message}` : alerts;

  const { data: retries } = await admin
    .from("integration_sync_logs")
    .select("id, integration_id, attempt")
    .eq("status", "failed")
    .lte("next_retry_at", new Date().toISOString())
    .limit(20);
  let retried = 0;
  for (const r of retries ?? []) {
    await admin.from("integration_sync_logs").update({ next_retry_at: null }).eq("id", r.id);
    await runPullSync(r.integration_id, null, r.attempt + 1).then(() => retried++).catch(() => {});
  }
  result.syncRetries = retried;

  // Scheduled pull for connected integrations not synced in 12 hours.
  const { data: stale } = await admin
    .from("integrations")
    .select("id")
    .eq("status", "connected")
    .eq("sync_enabled", true)
    .or(`last_synced_at.is.null,last_synced_at.lt.${new Date(Date.now() - 12 * 3600_000).toISOString()}`)
    .limit(20);
  let pulled = 0;
  for (const i of stale ?? []) await runPullSync(i.id, null).then(() => pulled++).catch(() => {});
  result.scheduledSyncs = pulled;

  result.delivered = await dispatchNotifications().catch((e) => `failed: ${e instanceof Error ? e.message : "error"}`);
  return NextResponse.json(result);
}
