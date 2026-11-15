import { describe, expect, it } from "vitest";
import { buildReport, dailyTrend, type MovementRecord } from "./reports";

const m = (p: Partial<MovementRecord>): MovementRecord => ({
  productId: "p1", productName: "Milk", unit: "gallon", type: "receive", source: "manual", quantityBefore: 0, quantityAfter: 0,
  quantityChange: 0, valueChange: 0, actorId: "u1", actorName: "Emma", createdAt: "2026-11-10T10:00:00Z", ...p,
});

const movements = [
  m({ type: "receive", quantityBefore: 0, quantityAfter: 10, quantityChange: 10, valueChange: 30, createdAt: "2026-11-09T09:00:00Z" }),
  m({ type: "sale", quantityBefore: 10, quantityAfter: 7, quantityChange: -3, valueChange: -9, createdAt: "2026-11-10T09:00:00Z", source: "pos", actorId: null, actorName: null }),
  m({ type: "expire", quantityBefore: 7, quantityAfter: 5, quantityChange: -2, valueChange: -6, createdAt: "2026-11-10T12:00:00Z", source: "voice" }),
  m({ type: "set_count", quantityBefore: 5, quantityAfter: 0, quantityChange: -5, valueChange: -15, createdAt: "2026-11-11T08:00:00Z" }),
  m({ productId: "p2", productName: "Bread", unit: "piece", type: "damage", quantityBefore: 4, quantityAfter: 3, quantityChange: -1, valueChange: -2, createdAt: "2026-11-11T09:00:00Z" }),
];
const products = [
  { id: "p1", name: "Milk", sku: "MLK", unit: "gallon", quantity: 0, costPrice: 3, createdAt: "2026-11-01T00:00:00Z" },
  { id: "p2", name: "Bread", sku: null, unit: "piece", quantity: 3, costPrice: 2, createdAt: "2026-11-01T00:00:00Z" },
];
const base = { movements, products, reviews: [], orders: [], from: "2026-11-01", to: "2026-11-15" };

describe("reports", () => {
  it("reconstructs end-of-day units backwards from today's total", () => {
    const trend = dailyTrend(movements, 3, ["2026-11-09", "2026-11-10", "2026-11-11"]);
    expect(trend).toEqual([
      { day: "2026-11-09", inbound: 10, outbound: 0, units: 14 },
      { day: "2026-11-10", inbound: 0, outbound: 5, units: 9 },
      { day: "2026-11-11", inbound: 0, outbound: 6, units: 3 },
    ]);
  });

  it("values expired and damaged losses", () => {
    expect(buildReport("expired_loss", base)).toEqual([{ product: "Milk", sku: "MLK", unit: "gallon", units: 2, loss_value: 6, incidents: 1, last_incident: "2026-11-10T12:00:00Z" }]);
    expect(buildReport("damaged_loss", base)[0]).toMatchObject({ product: "Bread", units: 1, loss_value: 2 });
  });

  it("totals shrinkage including count shortfalls", () => {
    expect(buildReport("shrinkage", base)[0]).toEqual({ product: "Milk", missing: 0, damaged: 0, expired: 2, count_shortfall: 5, loss_value: 21 });
  });

  it("counts stockouts and attributes activity", () => {
    expect(buildReport("stockout_frequency", base)).toEqual([{ product: "Milk", sku: "MLK", stockouts: 1, last_stockout: "2026-11-11T08:00:00Z", current_quantity: 0 }]);
    const activity = buildReport("employee_activity", base);
    expect(activity.find((r) => r.employee === "Emma")).toMatchObject({ movements: 4, voice: 1, counts: 1 });
    expect(activity.find((r) => r.employee === "POS")).toMatchObject({ movements: 1 });
  });

  it("summarizes weeks starting Monday", () => {
    expect(buildReport("weekly_summary", base).map((r) => r.week)).toEqual(["2026-11-09"]);
    expect(buildReport("weekly_summary", base)[0]).toMatchObject({ received: 10, sold: 3, lost: 3, loss_value: 8 });
  });

  it("values month ends from the ledger", () => {
    const rows = buildReport("monthly_valuation", { ...base, from: "2026-10-01", to: "2026-11-15" });
    expect(rows).toEqual([{ month: "2026-11-01", units: 3, value: 6 }, { month: "2026-10-01", units: 0, value: 0 }]);
  });

  it("scores AI accuracy", () => {
    const reviews = [
      { sourceType: "voice", status: "applied", wasEdited: false, aiConfidence: 0.9 },
      { sourceType: "voice", status: "applied", wasEdited: true, aiConfidence: 0.7 },
      { sourceType: "voice", status: "rejected", wasEdited: false, aiConfidence: 0.5 },
      { sourceType: "voice", status: "pending", wasEdited: false, aiConfidence: 0.8 },
    ];
    expect(buildReport("ai_accuracy", { ...base, reviews })).toEqual([{ source: "voice", proposals: 4, accepted_as_is: 1, accepted_after_edit: 1, rejected: 1, open: 1, accuracy_percent: 33.3, avg_confidence: 0.725 }]);
  });
});
