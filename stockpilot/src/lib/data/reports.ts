import "server-only";
import type { AppContext } from "@/lib/auth/session";
import { daysUntil, todayIso } from "@/lib/domain/expiry";
import { buildReport, dailyTrend, type MovementRecord, type ReportRow } from "@/lib/domain/reports";
import { invalid } from "@/lib/errors";
import { assertRole } from "./business";
import { listBatches, loadProducts } from "./catalog";
import type { MovementDoc } from "./model";
import { biz } from "./refs";
import { countOpenReviews } from "./review";

const toRecord = (m: MovementDoc): MovementRecord => ({
  productId: m.productId, productName: m.productName, unit: m.unit, type: m.type, source: m.source, quantityBefore: m.quantityBefore,
  quantityAfter: m.quantityAfter, quantityChange: m.quantityChange, valueChange: m.valueChange, actorId: m.actorId, actorName: m.actorName, createdAt: m.createdAt,
});

async function movementsBetween(businessId: string, fromIso: string, toIso: string, limit = 50_000) {
  const snap = await biz(businessId).movements.where("createdAt", ">=", fromIso).where("createdAt", "<", toIso).orderBy("createdAt").limit(limit).get();
  return snap.docs.map((d) => ({ ...d.data(), id: d.id }));
}

export async function dashboardSummary(ctx: AppContext) {
  const manager = ctx.role !== "employee";
  const today = todayIso(new Date(), ctx.business.timezone);
  const days = Array.from({ length: 30 }, (_, i) => new Date(Date.parse(`${today}T00:00:00Z`) - (29 - i) * 86_400_000).toISOString().slice(0, 10));
  const ref = biz(ctx.business.id);
  const [products, batches, movements, openOrders, pendingReviews, recentAi] = await Promise.all([
    loadProducts(ctx.business.id),
    listBatches(ctx.business.id),
    movementsBetween(ctx.business.id, `${days[0]}T00:00:00.000Z`, "9999"),
    manager ? ref.purchaseOrders.where("status", "in", ["draft", "approved"]).count().get() : null,
    countOpenReviews(ctx),
    (ctx.role === "employee" ? ref.aiExtractions.where("createdBy", "==", ctx.userId) : ref.aiExtractions).orderBy("createdAt", "desc").limit(5).get(),
  ]);
  const dated = batches.filter((b) => b.expiryDate);
  const inWindow = (lo: number, hi: number) => dated.filter((b) => { const d = daysUntil(b.expiryDate!, today); return d >= lo && d <= hi; }).length;
  const totalUnits = products.reduce((s, p) => s + p.quantity, 0);
  const damaged = movements.filter((m) => m.type === "damage");
  const extractionIds = recentAi.docs.map((d) => d.id);
  const reviewStats = extractionIds.length ? await ref.reviewItems.where("extractionId", "in", extractionIds).get() : null;

  const sales = new Map<string, { id: string; name: string; unit: string; units: number }>();
  for (const m of movements.filter((x) => x.type === "sale")) {
    const s = sales.get(m.productId) ?? { id: m.productId, name: m.productName, unit: m.unit, units: 0 };
    s.units -= m.quantityChange;
    sales.set(m.productId, s);
  }

  return {
    totalProducts: products.length,
    totalUnits,
    inventoryValue: manager ? Math.round(products.reduce((s, p) => s + p.quantity * p.costPrice, 0) * 100) / 100 : null,
    lowStock: products.filter((p) => p.status === "low_stock").length,
    outOfStock: products.filter((p) => p.status === "out_of_stock").length,
    expiringSoon: inWindow(0, ctx.business.expiryWarningDays),
    expired: dated.filter((b) => daysUntil(b.expiryDate!, today) < 0).length,
    damagedUnits30d: 0 - damaged.reduce((s, m) => s + m.quantityChange, 0),
    damagedValue30d: manager ? 0 - damaged.reduce((s, m) => s + m.valueChange, 0) : null,
    pendingPurchaseOrders: openOrders?.data().count ?? 0,
    pendingReviews,
    trend: dailyTrend(movements.map(toRecord), totalUnits, days),
    expiryBuckets: { expired: dated.filter((b) => daysUntil(b.expiryDate!, today) < 0).length, within7: inWindow(0, 7), within15: inWindow(8, 15), within30: inWindow(16, 30) },
    topSelling: [...sales.values()].sort((a, b) => b.units - a.units).slice(0, 5),
    recentMovements: [...movements].reverse().slice(0, 8),
    recentAi: recentAi.docs.map((d) => {
      const items = reviewStats?.docs.filter((r) => r.data().extractionId === d.id) ?? [];
      const e = d.data() as { sourceType: "voice" | "photo"; isValid: boolean; overallConfidence: number | null; createdAt: string };
      return { id: d.id, createdAt: e.createdAt, sourceType: e.sourceType, isValid: e.isValid, overallConfidence: e.overallConfidence, actions: items.length, applied: items.filter((r) => r.data().status === "applied").length };
    }),
  };
}

export async function runReport(ctx: AppContext, type: string, from: string, to: string): Promise<ReportRow[]> {
  assertRole(ctx, "manager");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || to < from) throw invalid("Choose a valid date range.");
  if ((Date.parse(to) - Date.parse(from)) / 86_400_000 > 731) throw invalid("Choose a range of at most two years.");
  const ref = biz(ctx.business.id);
  const toExclusive = new Date(Date.parse(`${to}T00:00:00Z`) + 86_400_000).toISOString();
  const needsAllLater = type === "monthly_valuation";
  const [movements, products, reviews, orders] = await Promise.all([
    movementsBetween(ctx.business.id, `${from}T00:00:00.000Z`, needsAllLater ? "9999" : toExclusive),
    loadProducts(ctx.business.id),
    type === "ai_accuracy" ? ref.reviewItems.where("createdAt", ">=", `${from}T00:00:00.000Z`).where("createdAt", "<", toExclusive).get() : null,
    type === "reorder_history" ? ref.purchaseOrders.where("createdAt", ">=", `${from}T00:00:00.000Z`).where("createdAt", "<", toExclusive).get() : null,
  ]);
  const inRange = needsAllLater ? movements : movements.filter((m) => m.createdAt < toExclusive);
  return buildReport(type, {
    movements: (needsAllLater ? movements : inRange).map(toRecord),
    products: products.map((p) => ({ id: p.id, name: p.name, sku: p.sku, unit: p.unit, quantity: p.quantity, costPrice: p.costPrice, createdAt: p.createdAt })),
    reviews: reviews?.docs.map((d) => ({ sourceType: d.data().sourceType, status: d.data().status, wasEdited: d.data().wasEdited, aiConfidence: d.data().aiConfidence })) ?? [],
    orders: orders?.docs.map((d) => { const o = d.data(); return { poNumber: o.poNumber, supplierName: o.supplierName, status: o.status, subtotal: o.subtotal, generatedByAi: o.generatedByAi, lines: o.lines.length, createdAt: o.createdAt, approvedAt: o.approvedAt, sentAt: o.sentAt }; }) ?? [],
    from,
    to,
  });
}

export async function listMovements(ctx: AppContext, filter: { type?: string | null; source?: string | null; productId?: string | null; from?: string | null; to?: string | null }, page: number, pageSize = 50) {
  let q = biz(ctx.business.id).movements as FirebaseFirestore.Query<MovementDoc>;
  if (filter.productId) q = q.where("productId", "==", filter.productId);
  if (filter.type) q = q.where("type", "==", filter.type);
  if (filter.source) q = q.where("source", "==", filter.source);
  if (filter.from) q = q.where("createdAt", ">=", `${filter.from}T00:00:00.000Z`);
  if (filter.to) q = q.where("createdAt", "<", new Date(Date.parse(`${filter.to}T00:00:00Z`) + 86_400_000).toISOString());
  q = q.orderBy("createdAt", "desc");
  const [snap, count] = await Promise.all([q.offset((page - 1) * pageSize).limit(pageSize).get(), q.count().get()]);
  return { rows: snap.docs.map((d) => ({ ...d.data(), id: d.id })), total: count.data().count };
}
