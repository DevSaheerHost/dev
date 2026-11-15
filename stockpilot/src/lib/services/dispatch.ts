import "server-only";
import webpush from "web-push";
import { DEFAULT_PREFS } from "@/lib/data/business";
import { biz, nowIso, pushSubscriptions, users } from "@/lib/data/refs";
import { publicEnv, serverEnv } from "@/lib/env";
import { sendEmail, sendWhatsApp } from "./channels";

/** Delivers a business's new notifications over the channels each user opted into. */
export async function dispatchNotifications(businessId: string): Promise<{ email: number; push: number; whatsapp: number }> {
  const env = serverEnv();
  const ref = biz(businessId);
  const since = new Date(Date.now() - 36 * 3600_000).toISOString();
  const snap = await ref.notifications.where("createdAt", ">=", since).limit(1000).get();
  const pending = snap.docs.filter((d) => !d.data().readAt && (!d.data().emailSentAt || !d.data().pushSentAt || !d.data().whatsappSentAt));
  const counts = { email: 0, push: 0, whatsapp: 0 };
  if (pending.length === 0) return counts;

  const business = (await ref.doc.get()).data();
  const name = business?.name ?? "StockPilot";
  const appUrl = publicEnv().NEXT_PUBLIC_APP_URL;
  const pushReady = !!(env.VAPID_PRIVATE_KEY && publicEnv().NEXT_PUBLIC_VAPID_PUBLIC_KEY && env.VAPID_SUBJECT);
  if (pushReady) webpush.setVapidDetails(env.VAPID_SUBJECT!, publicEnv().NEXT_PUBLIC_VAPID_PUBLIC_KEY!, env.VAPID_PRIVATE_KEY!);

  const byUser = new Map<string, typeof pending>();
  for (const d of pending) byUser.set(d.data().userId, [...(byUser.get(d.data().userId) ?? []), d]);
  const now = nowIso();

  for (const [userId, list] of byUser) {
    const pref = (await ref.notificationPrefs.doc(userId).get()).data() ?? DEFAULT_PREFS;
    const wanted = list.filter((d) => pref.types?.[d.data().type] !== false);
    const email = (await users().doc(userId).get()).data()?.email;

    const emailBatch = wanted.filter((d) => !d.data().emailSentAt);
    if (pref.emailEnabled && emailBatch.length && email) {
      const body = [`${name} — ${emailBatch.length} inventory ${emailBatch.length === 1 ? "alert" : "alerts"}:`, "", ...emailBatch.map((d) => { const n = d.data(); return `• ${n.title}${n.body ? ` — ${n.body}` : ""}${n.link ? `\n  ${appUrl}${n.link}` : ""}`; }), "", `Manage alerts: ${appUrl}/settings#notifications`].join("\n");
      const r = await sendEmail(email, `${name}: ${emailBatch[0].data().title}${emailBatch.length > 1 ? ` (+${emailBatch.length - 1} more)` : ""}`, body);
      if (r.sent) {
        counts.email++;
        await Promise.all(emailBatch.map((d) => d.ref.update({ emailSentAt: now })));
      }
    }

    const pushBatch = wanted.filter((d) => !d.data().pushSentAt);
    if (pushReady && pref.pushEnabled && pushBatch.length) {
      const subs = await pushSubscriptions(userId).get();
      const first = pushBatch[0].data();
      const payload = JSON.stringify({ title: pushBatch.length === 1 ? first.title : `${pushBatch.length} inventory alerts`, body: pushBatch.length === 1 ? first.body ?? name : pushBatch.map((d) => d.data().title).slice(0, 3).join(" · "), url: first.link ?? "/notifications" });
      for (const s of subs.docs) {
        try {
          await webpush.sendNotification({ endpoint: s.data().endpoint, keys: { p256dh: s.data().p256dh, auth: s.data().auth } }, payload, { TTL: 3600 });
          counts.push++;
        } catch (e) {
          const status = (e as { statusCode?: number }).statusCode;
          if (status === 404 || status === 410) await s.ref.delete();
        }
      }
      await Promise.all(pushBatch.map((d) => d.ref.update({ pushSentAt: now })));
    }

    const waBatch = wanted.filter((d) => !d.data().whatsappSentAt && ["out_of_stock", "expired", "sync_failed"].includes(d.data().type));
    if (pref.whatsappEnabled && pref.whatsappNumber && waBatch.length) {
      const r = await sendWhatsApp(pref.whatsappNumber, `${name}:\n${waBatch.map((d) => `• ${d.data().title}`).join("\n")}`);
      if (r.sent) {
        counts.whatsapp++;
        await Promise.all(waBatch.map((d) => d.ref.update({ whatsappSentAt: now })));
      }
    }
  }
  return counts;
}
