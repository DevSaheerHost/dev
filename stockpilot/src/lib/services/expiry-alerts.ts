import "server-only";
import { listBatches, loadProducts } from "@/lib/data/catalog";
import { notify } from "@/lib/data/notify";
import { biz } from "@/lib/data/refs";
import { daysUntil, todayIso } from "@/lib/domain/expiry";
import { formatNumber } from "@/lib/utils";

/** Daily sweep: notify managers about expired and soon-expiring batches (deduplicated). */
export async function runExpiryAlerts(businessId: string): Promise<number> {
  const business = (await biz(businessId).doc.get()).data();
  if (!business) return 0;
  const today = todayIso(new Date(), business.timezone);
  const window = Math.min(business.expiryWarningDays, 30);
  const [batches, products] = await Promise.all([listBatches(businessId), loadProducts(businessId)]);
  const names = new Map(products.map((p) => [p.id, p.name]));
  let count = 0;
  for (const b of batches) {
    if (!b.expiryDate || !names.has(b.productId)) continue;
    const days = daysUntil(b.expiryDate, today);
    if (days > window) continue;
    const name = names.get(b.productId)!;
    await notify(businessId, days < 0
      ? { type: "expired", severity: "critical", title: `${name} has expired stock`, body: `${formatNumber(b.quantity)} units expired on ${b.expiryDate}. Remove them from the shelf and record the loss.`, link: "/expiring", dedupeKey: `expired:${b.id}` }
      : { type: "expiring", severity: "warning", title: `${name} expires soon`, body: `${formatNumber(b.quantity)} units expire on ${b.expiryDate}.`, link: "/expiring", dedupeKey: `expiring:${b.id}:${days <= 7}` });
    count++;
  }
  return count;
}
