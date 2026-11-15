import "server-only";
import webpush from "web-push";
import { serverEnv, publicEnv } from "@/lib/env";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { sendEmail, sendWhatsApp } from "./channels";

interface Pending {
  id: string; business_id: string; user_id: string; type: string; title: string; body: string | null; link: string | null;
  email_sent_at: string | null; push_sent_at: string | null; whatsapp_sent_at: string | null;
}
interface Prefs {
  business_id: string; user_id: string; email_enabled: boolean; push_enabled: boolean; whatsapp_enabled: boolean;
  whatsapp_number: string | null; types: Record<string, boolean>;
}

/** Delivers new notifications over the channels each user opted into. In-app delivery is the table itself. */
export async function dispatchNotifications(): Promise<{ email: number; push: number; whatsapp: number }> {
  const admin = createSupabaseAdminClient();
  const env = serverEnv();
  const since = new Date(Date.now() - 36 * 3600_000).toISOString();
  const { data } = await admin
    .from("notifications")
    .select("id, business_id, user_id, type, title, body, link, email_sent_at, push_sent_at, whatsapp_sent_at")
    .gte("created_at", since)
    .is("read_at", null)
    .or("email_sent_at.is.null,push_sent_at.is.null,whatsapp_sent_at.is.null")
    .limit(1000);
  const pending = (data ?? []) as Pending[];
  if (pending.length === 0) return { email: 0, push: 0, whatsapp: 0 };

  const userIds = [...new Set(pending.map((p) => p.user_id))];
  const [{ data: prefs }, { data: profiles }, { data: subs }, { data: businesses }] = await Promise.all([
    admin.from("notification_preferences").select("*").in("user_id", userIds),
    admin.from("profiles").select("id, email").in("id", userIds),
    admin.from("push_subscriptions").select("id, user_id, endpoint, p256dh, auth").in("user_id", userIds),
    admin.from("businesses").select("id, name").in("id", [...new Set(pending.map((p) => p.business_id))]),
  ]);
  const prefOf = (b: string, u: string): Prefs =>
    (prefs ?? []).find((p) => p.business_id === b && p.user_id === u) ?? { business_id: b, user_id: u, email_enabled: true, push_enabled: false, whatsapp_enabled: false, whatsapp_number: null, types: {} };
  const emailOf = new Map((profiles ?? []).map((p) => [p.id, p.email as string | null]));
  const nameOf = new Map((businesses ?? []).map((b) => [b.id, b.name as string]));
  const pushReady = !!(env.VAPID_PRIVATE_KEY && publicEnv().NEXT_PUBLIC_VAPID_PUBLIC_KEY && env.VAPID_SUBJECT);
  if (pushReady) webpush.setVapidDetails(env.VAPID_SUBJECT!, publicEnv().NEXT_PUBLIC_VAPID_PUBLIC_KEY!, env.VAPID_PRIVATE_KEY!);

  const counts = { email: 0, push: 0, whatsapp: 0 };
  const now = new Date().toISOString();
  const groups = new Map<string, Pending[]>();
  for (const n of pending) {
    const key = `${n.business_id}:${n.user_id}`;
    groups.set(key, [...(groups.get(key) ?? []), n]);
  }
  const appUrl = publicEnv().NEXT_PUBLIC_APP_URL;

  for (const [, list] of groups) {
    const { business_id, user_id } = list[0];
    const pref = prefOf(business_id, user_id);
    const wanted = list.filter((n) => pref.types?.[n.type] !== false);
    const business = nameOf.get(business_id) ?? "StockPilot";

    const emailBatch = wanted.filter((n) => !n.email_sent_at);
    if (pref.email_enabled && emailBatch.length && emailOf.get(user_id)) {
      const body = [`${business} — ${emailBatch.length} inventory ${emailBatch.length === 1 ? "alert" : "alerts"}:`, "", ...emailBatch.map((n) => `• ${n.title}${n.body ? ` — ${n.body}` : ""}${n.link ? `\n  ${appUrl}${n.link}` : ""}`), "", `Manage alerts: ${appUrl}/settings#notifications`].join("\n");
      const r = await sendEmail(emailOf.get(user_id)!, `${business}: ${emailBatch[0].title}${emailBatch.length > 1 ? ` (+${emailBatch.length - 1} more)` : ""}`, body);
      if (r.sent) {
        counts.email++;
        await admin.from("notifications").update({ email_sent_at: now }).in("id", emailBatch.map((n) => n.id));
      }
    }

    const pushBatch = wanted.filter((n) => !n.push_sent_at);
    const userSubs = (subs ?? []).filter((s) => s.user_id === user_id);
    if (pushReady && pref.push_enabled && pushBatch.length && userSubs.length) {
      const payload = JSON.stringify({ title: pushBatch.length === 1 ? pushBatch[0].title : `${pushBatch.length} inventory alerts`, body: pushBatch.length === 1 ? pushBatch[0].body ?? business : pushBatch.map((n) => n.title).slice(0, 3).join(" · "), url: pushBatch[0].link ?? "/notifications" });
      for (const s of userSubs) {
        try {
          await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 3600 });
          counts.push++;
        } catch (e) {
          const status = (e as { statusCode?: number }).statusCode;
          if (status === 404 || status === 410) await admin.from("push_subscriptions").delete().eq("id", s.id);
        }
      }
      await admin.from("notifications").update({ push_sent_at: now }).in("id", pushBatch.map((n) => n.id));
    }

    const waBatch = wanted.filter((n) => !n.whatsapp_sent_at && ["out_of_stock", "expired", "sync_failed"].includes(n.type));
    if (pref.whatsapp_enabled && pref.whatsapp_number && waBatch.length) {
      const r = await sendWhatsApp(pref.whatsapp_number, `${business}:\n${waBatch.map((n) => `• ${n.title}`).join("\n")}`);
      if (r.sent) {
        counts.whatsapp++;
        await admin.from("notifications").update({ whatsapp_sent_at: now }).in("id", waBatch.map((n) => n.id));
      }
    }
  }
  return counts;
}
