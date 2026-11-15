/** Report and dashboard aggregations over raw records (pure, unit-tested). */
import type { MovementType } from "./types";

export interface MovementRecord {
  productId: string;
  productName: string;
  unit: string;
  type: MovementType;
  source: string;
  quantityBefore: number;
  quantityAfter: number;
  quantityChange: number;
  valueChange: number;
  actorId: string | null;
  actorName: string | null;
  createdAt: string;
}

export interface ProductRecord {
  id: string;
  name: string;
  sku: string | null;
  unit: string;
  quantity: number;
  costPrice: number;
  createdAt: string;
}

export interface ReviewRecord {
  sourceType: string;
  status: string;
  wasEdited: boolean;
  aiConfidence: number;
}

export interface PurchaseOrderRecord {
  poNumber: string;
  supplierName: string;
  status: string;
  subtotal: number;
  generatedByAi: boolean;
  lines: number;
  createdAt: string;
  approvedAt: string | null;
  sentAt: string | null;
}

const round = (n: number, d = 3) => Math.round(n * 10 ** d) / 10 ** d + 0; // "+ 0" turns -0 into 0
const day = (iso: string) => iso.slice(0, 10);
const LOSS: MovementType[] = ["damage", "expire", "missing"];

function weekStart(iso: string): string {
  const d = new Date(`${day(iso)}T00:00:00Z`);
  const offset = (d.getUTCDay() + 6) % 7; // Monday
  d.setUTCDate(d.getUTCDate() - offset);
  return d.toISOString().slice(0, 10);
}

function group<T>(items: T[], key: (t: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const i of items) m.set(key(i), [...(m.get(key(i)) ?? []), i]);
  return m;
}

const sum = <T>(items: T[], f: (t: T) => number) => items.reduce((s, i) => s + f(i), 0);

export function dailyTrend(movements: MovementRecord[], currentUnits: number, days: string[]) {
  const byDay = group(movements, (m) => day(m.createdAt));
  const rows = days.map((d) => {
    const list = byDay.get(d) ?? [];
    return {
      day: d,
      inbound: round(sum(list.filter((m) => m.quantityChange > 0), (m) => m.quantityChange)),
      outbound: round(-sum(list.filter((m) => m.quantityChange < 0), (m) => m.quantityChange)),
      net: round(sum(list, (m) => m.quantityChange)),
    };
  });
  // Units at end of each day, reconstructed backwards from today's total.
  let units = currentUnits;
  const out = new Array(rows.length);
  for (let i = rows.length - 1; i >= 0; i--) {
    out[i] = { day: rows[i].day, inbound: rows[i].inbound, outbound: rows[i].outbound, units: round(units) };
    units -= rows[i].net;
  }
  return out as { day: string; inbound: number; outbound: number; units: number }[];
}

export type ReportRow = Record<string, string | number | boolean | null>;

export function buildReport(
  type: string,
  data: { movements: MovementRecord[]; products: ProductRecord[]; reviews: ReviewRecord[]; orders: PurchaseOrderRecord[]; from: string; to: string },
): ReportRow[] {
  const { movements } = data;
  switch (type) {
    case "daily_changes":
      return [...group(movements, (m) => `${day(m.createdAt)}|${m.productId}`).values()]
        .map((list) => ({
          day: day(list[0].createdAt), product: list[0].productName, unit: list[0].unit,
          added: round(sum(list.filter((m) => m.quantityChange > 0), (m) => m.quantityChange)),
          removed: round(-sum(list.filter((m) => m.quantityChange < 0), (m) => m.quantityChange)),
          net: round(sum(list, (m) => m.quantityChange)), movements: list.length,
        }))
        .sort((a, b) => b.day.localeCompare(a.day) || a.product.localeCompare(b.product));

    case "weekly_summary":
      return [...group(movements, (m) => weekStart(m.createdAt)).entries()]
        .map(([week, list]) => ({
          week, movements: list.length, products_touched: new Set(list.map((m) => m.productId)).size,
          received: round(sum(list.filter((m) => ["receive", "return", "initial"].includes(m.type)), (m) => m.quantityChange)),
          sold: round(-sum(list.filter((m) => m.type === "sale"), (m) => m.quantityChange)),
          lost: round(-sum(list.filter((m) => LOSS.includes(m.type)), (m) => m.quantityChange)),
          loss_value: round(-sum(list.filter((m) => LOSS.includes(m.type)), (m) => m.valueChange), 2),
        }))
        .sort((a, b) => b.week.localeCompare(a.week));

    case "monthly_valuation": {
      // Units at each month end = current quantity minus everything that happened after it.
      const months: string[] = [];
      const cursor = new Date(`${data.from.slice(0, 7)}-01T00:00:00Z`);
      const last = data.to.slice(0, 7);
      while (cursor.toISOString().slice(0, 7) <= last && months.length < 25) {
        months.push(cursor.toISOString().slice(0, 7));
        cursor.setUTCMonth(cursor.getUTCMonth() + 1);
      }
      const byProduct = group(movements, (m) => m.productId);
      return months
        .map((month) => {
          const next = new Date(`${month}-01T00:00:00Z`);
          next.setUTCMonth(next.getUTCMonth() + 1);
          const cutoff = next.toISOString();
          let units = 0;
          let value = 0;
          for (const p of data.products.filter((x) => x.createdAt < cutoff)) {
            const later = sum((byProduct.get(p.id) ?? []).filter((m) => m.createdAt >= cutoff), (m) => m.quantityChange);
            const u = Math.max(0, p.quantity - later);
            units += u;
            value += u * p.costPrice;
          }
          return { month: `${month}-01`, units: round(units), value: round(value, 2) };
        })
        .reverse();
    }

    case "expired_loss":
    case "damaged_loss": {
      const t: MovementType = type === "expired_loss" ? "expire" : "damage";
      return [...group(movements.filter((m) => m.type === t), (m) => m.productId).values()]
        .map((list) => ({
          product: list[0].productName, sku: data.products.find((p) => p.id === list[0].productId)?.sku ?? null, unit: list[0].unit,
          units: round(-sum(list, (m) => m.quantityChange)), loss_value: round(-sum(list, (m) => m.valueChange), 2), incidents: list.length,
          last_incident: list.map((m) => m.createdAt).sort().at(-1) ?? null,
        }))
        .sort((a, b) => b.loss_value - a.loss_value);
    }

    case "shrinkage": {
      const shrink = movements.filter((m) => LOSS.includes(m.type) || (m.type === "set_count" && m.quantityChange < 0));
      return [...group(shrink, (m) => m.productId).values()]
        .map((list) => {
          const of = (t: MovementType) => round(-sum(list.filter((m) => m.type === t), (m) => m.quantityChange));
          return {
            product: list[0].productName, missing: of("missing"), damaged: of("damage"), expired: of("expire"),
            count_shortfall: of("set_count"), loss_value: round(-sum(list, (m) => m.valueChange), 2),
          };
        })
        .sort((a, b) => b.loss_value - a.loss_value);
    }

    case "stockout_frequency":
      return [...group(movements.filter((m) => m.quantityAfter === 0 && m.quantityBefore > 0), (m) => m.productId).entries()]
        .map(([productId, list]) => {
          const p = data.products.find((x) => x.id === productId);
          return { product: list[0].productName, sku: p?.sku ?? null, stockouts: list.length, last_stockout: list.map((m) => m.createdAt).sort().at(-1) ?? null, current_quantity: p?.quantity ?? null };
        })
        .sort((a, b) => b.stockouts - a.stockouts);

    case "reorder_history":
      return data.orders
        .map((o) => ({ po_number: o.poNumber, supplier: o.supplierName, status: o.status, lines: o.lines, subtotal: o.subtotal, generated_by_ai: o.generatedByAi, created_at: o.createdAt, sent_at: o.sentAt }))
        .sort((a, b) => b.created_at.localeCompare(a.created_at));

    case "employee_activity":
      return [...group(movements, (m) => m.actorId ?? `system:${m.source}`).values()]
        .map((list) => ({
          employee: list[0].actorName ?? (list[0].source === "pos" ? "POS" : "System"), movements: list.length,
          voice: list.filter((m) => m.source === "voice").length, photo: list.filter((m) => m.source === "photo").length,
          manual: list.filter((m) => m.source === "manual").length, counts: list.filter((m) => m.type === "set_count").length,
          last_activity: list.map((m) => m.createdAt).sort().at(-1) ?? null,
        }))
        .sort((a, b) => b.movements - a.movements);

    case "ai_accuracy":
      return [...group(data.reviews, (r) => r.sourceType).entries()].map(([source, list]) => {
        const accepted = list.filter((r) => r.status === "applied" && !r.wasEdited).length;
        const edited = list.filter((r) => r.status === "applied" && r.wasEdited).length;
        const rejected = list.filter((r) => r.status === "rejected").length;
        return {
          source, proposals: list.length, accepted_as_is: accepted, accepted_after_edit: edited, rejected,
          open: list.filter((r) => r.status === "pending" || r.status === "needs_clarification").length,
          accuracy_percent: accepted + edited + rejected ? round((100 * accepted) / (accepted + edited + rejected), 1) : null,
          avg_confidence: list.length ? round(sum(list, (r) => r.aiConfidence) / list.length) : null,
        };
      });

    default:
      return [];
  }
}
