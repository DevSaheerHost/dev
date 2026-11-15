import { NextResponse, type NextRequest } from "next/server";
import { biz } from "@/lib/data/refs";
import { serverEnv } from "@/lib/env";
import { db } from "@/lib/firebase/admin";
import { runPullSync } from "@/lib/integrations/sync";
import type { Provider } from "@/lib/integrations/types";
import { safeEqual } from "@/lib/security/crypto";
import { dispatchNotifications } from "@/lib/services/dispatch";
import { runExpiryAlerts } from "@/lib/services/expiry-alerts";

export const maxDuration = 300;

/**
 * Scheduled maintenance (Vercel Cron sends `Authorization: Bearer $CRON_SECRET`):
 * expiry alerts, failed-sync retries, scheduled POS pulls and notification delivery.
 */
export async function GET(request: NextRequest) {
  const secret = serverEnv().CRON_SECRET;
  if (!secret || !safeEqual(request.headers.get("authorization") ?? "", `Bearer ${secret}`)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const result = { businesses: 0, expiryAlerts: 0, syncRetries: 0, scheduledSyncs: 0, delivered: { email: 0, push: 0, whatsapp: 0 }, errors: 0 };
  const now = new Date().toISOString();
  const staleBefore = new Date(Date.now() - 12 * 3600_000).toISOString();
  for (const doc of (await db().collection("businesses").select().get()).docs) {
    result.businesses++;
    const businessId = doc.id;
    try {
      result.expiryAlerts += await runExpiryAlerts(businessId);
      const ref = biz(businessId);
      const failed = await ref.syncLogs.where("status", "==", "failed").where("nextRetryAt", "<=", now).limit(10).get();
      for (const log of failed.docs) {
        await log.ref.update({ nextRetryAt: null });
        await runPullSync(businessId, log.data().provider as Provider, null, log.data().attempt + 1).then(() => result.syncRetries++).catch(() => {});
      }
      for (const i of (await ref.integrations.where("status", "==", "connected").get()).docs) {
        const d = i.data();
        if (d.syncEnabled && (!d.lastSyncedAt || d.lastSyncedAt < staleBefore)) await runPullSync(businessId, d.provider, null).then(() => result.scheduledSyncs++).catch(() => {});
      }
      const delivered = await dispatchNotifications(businessId);
      result.delivered.email += delivered.email;
      result.delivered.push += delivered.push;
      result.delivered.whatsapp += delivered.whatsapp;
    } catch (e) {
      result.errors++;
      console.error("Cron failed for a business", e);
    }
  }
  return NextResponse.json(result);
}
