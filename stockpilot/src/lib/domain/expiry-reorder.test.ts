import { describe, expect, it } from "vitest";
import { daysUntil, expiryBucket, expiryLoss, fefoOrder, planFefoDeduction, todayIso } from "./expiry";
import { planDraftOrders, stockStatus, suggestReorderQuantity } from "./reorder";
import { buildOrderMessage, mailtoLink, whatsappLink } from "./purchase-order-message";

describe("expiry", () => {
  const today = "2026-11-15";
  it("buckets by days remaining", () => {
    expect(expiryBucket("2026-11-14", today)).toBe("expired");
    expect(expiryBucket("2026-11-15", today)).toBe("7");
    expect(expiryBucket("2026-11-22", today)).toBe("7");
    expect(expiryBucket("2026-11-30", today)).toBe("15");
    expect(expiryBucket("2026-12-15", today)).toBe("30");
    expect(expiryBucket("2027-01-30", today)).toBe("later");
    expect(expiryBucket(null, today)).toBe("none");
    expect(daysUntil("2026-12-01", today)).toBe(16);
  });

  it("orders batches first-expired-first-out and plans deductions", () => {
    const batches = [
      { id: "c", expiryDate: null, quantity: 5 },
      { id: "b", expiryDate: "2027-01-01", quantity: 5 },
      { id: "a", expiryDate: "2026-12-01", quantity: 3 },
    ];
    expect(fefoOrder(batches).map((b) => b.id)).toEqual(["a", "b", "c"]);
    expect(planFefoDeduction(batches, 6)).toEqual([{ batchId: "a", quantity: 3 }, { batchId: "b", quantity: 3 }]);
  });

  it("values losses and resolves the business-local day", () => {
    expect(expiryLoss(3, 2.333)).toBe(7);
    expect(todayIso(new Date("2026-11-15T23:30:00Z"), "Asia/Kolkata")).toBe("2026-11-16");
  });
});

describe("reorder", () => {
  it("classifies stock levels", () => {
    expect(stockStatus(0, 10)).toBe("out_of_stock");
    expect(stockStatus(4, 10)).toBe("low_stock");
    expect(stockStatus(10, 10)).toBe("ok");
    expect(stockStatus(3, 0)).toBe("ok");
  });

  it("suggests 24 for AA batteries at 4 with threshold 10 and packs of 12", () => {
    expect(suggestReorderQuantity({ currentQuantity: 4, reorderThreshold: 10, packSize: 12 })).toBe(24);
    expect(suggestReorderQuantity({ currentQuantity: 4, reorderThreshold: 10 })).toBe(16);
    expect(suggestReorderQuantity({ currentQuantity: 4, reorderThreshold: 10, reorderQuantity: 30 })).toBe(30);
    expect(suggestReorderQuantity({ currentQuantity: 12, reorderThreshold: 10 })).toBe(0);
  });

  it("groups draft orders by preferred supplier and keeps unassigned items aside", () => {
    const plan = planDraftOrders([
      { productId: "1", productName: "AA Batteries", unit: "case", currentQuantity: 4, reorderThreshold: 10, reorderQuantity: null, supplierId: "s1", supplierName: "Acme", unitCost: 18.5, packSize: 12 },
      { productId: "2", productName: "Milk", unit: "gallon", currentQuantity: 0, reorderThreshold: 10, reorderQuantity: 20, supplierId: "s2", supplierName: "Valley Farms", unitCost: 3.1, packSize: null },
      { productId: "3", productName: "Cough Syrup", unit: "box", currentQuantity: 1, reorderThreshold: 6, reorderQuantity: 12, supplierId: "s1", supplierName: "Acme", unitCost: 4, packSize: null },
      { productId: "4", productName: "Soap", unit: "piece", currentQuantity: 1, reorderThreshold: 5, reorderQuantity: null, supplierId: null, supplierName: null, unitCost: 1, packSize: null },
      { productId: "5", productName: "Fine", unit: "piece", currentQuantity: 50, reorderThreshold: 5, reorderQuantity: null, supplierId: "s1", supplierName: "Acme", unitCost: 1, packSize: null },
    ]);
    expect(plan.orders.map((o) => o.supplierName)).toEqual(["Acme", "Valley Farms"]);
    expect(plan.orders[0].lines.map((l) => [l.productName, l.quantity])).toEqual([["AA Batteries", 24], ["Cough Syrup", 12]]);
    expect(plan.orders[0].estimatedTotal).toBe(492);
    expect(plan.unassigned.map((u) => u.productName)).toEqual(["Soap"]);
  });
});

describe("purchase order messages", () => {
  const message = buildOrderMessage({
    businessName: "Corner Pharmacy",
    poNumber: "PO-00012",
    supplierName: "Acme",
    lines: [
      { productName: "AA Batteries", quantity: 24, unit: "case" },
      { productName: "Children's Cough Syrup", quantity: 12, unit: "box" },
      { productName: "Milk", quantity: 1, unit: "gallon" },
    ],
  });

  it("matches the replenishment template", () => {
    expect(message.subject).toBe("Stock Replenishment Request – PO-00012 – Corner Pharmacy");
    expect(message.body).toContain("Hello,\n\nWe would like to order the following items (order PO-00012):");
    expect(message.body).toContain("- AA Batteries: 24 cases\n- Children's Cough Syrup: 12 boxes\n- Milk: 1 gallon");
    expect(message.body).toContain("Please confirm availability and expected delivery date.");
  });

  it("strips header-injection characters from the subject", () => {
    const m = buildOrderMessage({ businessName: "Evil\r\nBcc: x@y.z", poNumber: "PO-1", supplierName: "S", lines: [] });
    expect(m.subject).not.toMatch(/[\r\n]/);
  });

  it("builds safe deep links", () => {
    expect(whatsappLink("+1 (555) 010-2030", "hi there")).toBe("https://wa.me/15550102030?text=hi%20there");
    expect(whatsappLink("12", "x")).toBeNull();
    expect(mailtoLink("orders@acme.test", "S", "B")).toBe("mailto:orders%40acme.test?subject=S&body=B");
    expect(mailtoLink("javascript:alert(1)", "S", "B")).toBeNull();
  });
});
