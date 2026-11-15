/**
 * Integration tests for the Firestore data layer, run against the real
 * Firestore + Auth emulators (`npm run test:firebase`).
 */
import { beforeAll, describe, expect, it } from "vitest";
import { clearFirestore, contextFor, createAuthUser, requireEmulators } from "@/test/emulator";
import type { AppContext } from "@/lib/auth/session";

requireEmulators();

const { acceptInvitation, createBusiness, createInvitation, updateMember } = await import("./business");
const { createProduct, getProduct, listBatches, deleteProduct, setArchived } = await import("./catalog");
const { applyMovement } = await import("./stock");
const { createPurchaseOrder, transitionPurchaseOrder, receivePoLine, getPurchaseOrder, editDraft, saveSupplier } = await import("./purchasing");
const { applyReviewItem, persistVoiceExtraction, rejectReviewItem, listOpenReviewItems } = await import("./review");
const { dashboardSummary, runReport } = await import("./reports");
const { rateLimit } = await import("./rate-limit");
const { biz } = await import("./refs");
const { parseVoiceCommandLocally } = await import("@/lib/ai/local-parser");
const { parseModelJson, voiceExtractionSchema } = await import("@/lib/ai/schemas");

let owner: AppContext, manager: AppContext, employee: AppContext, employee2: AppContext, rival: AppContext;
let n = 0;
const key = (p = "k") => `${p}:${Date.now()}:${n++}`;
const product = (ctx: AppContext, name: string, extra: Partial<Parameters<typeof createProduct>[1]> = {}, opening?: number) =>
  createProduct(ctx, {
    name, sku: null, barcode: null, brand: null, category: null, description: null, color: null, packageSize: null, synonyms: [],
    costPrice: 2, sellingPrice: 4, unit: "piece", reorderThreshold: 10, reorderQuantity: null, storageLocation: null,
    preferredSupplierId: null, locationId: null, trackExpiry: false, ...extra,
  }, opening ? { quantity: opening, batchNumber: null, expiryDate: null } : undefined);
const move = (ctx: AppContext, productId: string, type: Parameters<typeof applyMovement>[3]["type"], quantity: number, extra: Partial<Parameters<typeof applyMovement>[3]> = {}) =>
  applyMovement(ctx.business.id, ctx.business, { userId: ctx.userId, name: ctx.fullName, role: ctx.role }, { productId, type, quantity, source: "manual", idempotencyKey: key(), ...extra });
const qty = async (ctx: AppContext, id: string) => (await getProduct(ctx.business.id, id))!.quantity;

beforeAll(async () => {
  await clearFirestore();
  const o = await createAuthUser(`owner-${Date.now()}@example.com`, "Olivia Owner");
  const m = await createAuthUser(`manager-${Date.now()}@example.com`, "Manny Manager");
  const e = await createAuthUser(`emp-${Date.now()}@example.com`, "Emma Employee");
  const e2 = await createAuthUser(`emp2-${Date.now()}@example.com`, "Eli Employee");
  const r = await createAuthUser(`rival-${Date.now()}@example.com`, "Rita Rival");
  const bizA = await createBusiness(o, { name: "Corner Pharmacy", businessType: "pharmacy", currency: "USD", timezone: "UTC", locationName: "Main store" });
  const bizB = await createBusiness(r, { name: "Rival Hardware", businessType: "hardware", currency: "USD", timezone: "UTC", locationName: "Main" });
  owner = await contextFor(o.userId, bizA);
  for (const [u, role] of [[m, "manager"], [e, "employee"], [e2, "employee"]] as const) {
    await acceptInvitation(u, await createInvitation(owner, u.email, role));
  }
  manager = await contextFor(m.userId, bizA);
  employee = await contextFor(e.userId, bizA);
  employee2 = await contextFor(e2.userId, bizA);
  rival = await contextFor(r.userId, bizB);
});

describe("onboarding and team", () => {
  it("creates the owner membership and a primary location", async () => {
    expect(owner.role).toBe("owner");
    expect((await biz(owner.business.id).locations.where("isPrimary", "==", true).get()).size).toBe(1);
    expect([manager.role, employee.role]).toEqual(["manager", "employee"]);
  });

  it("requires a verified, matching email to accept an invitation, once", async () => {
    const unverified = await createAuthUser(`unverified-${Date.now()}@example.com`, "U", false);
    const t1 = await createInvitation(owner, unverified.email, "employee");
    await expect(acceptInvitation(unverified, t1)).rejects.toMatchObject({ code: "email_unverified" });
    const other = await createAuthUser(`other-${Date.now()}@example.com`, "O");
    await expect(acceptInvitation(other, t1)).rejects.toMatchObject({ code: "invitation_email_mismatch" });
    const right = { ...unverified, emailVerified: true };
    await acceptInvitation(right, t1);
    await expect(acceptInvitation(right, t1)).rejects.toMatchObject({ code: "invalid_invitation" });
    await updateMember(owner, right.userId, "remove");
  });

  it("only lets owners invite and never removes the last owner", async () => {
    await expect(createInvitation(manager, "x@example.com", "employee")).rejects.toMatchObject({ code: "forbidden" });
    await expect(updateMember(owner, owner.userId, { role: "manager" })).rejects.toMatchObject({ code: "last_owner" });
    await expect(updateMember(employee, manager.userId, { role: "owner" })).rejects.toMatchObject({ code: "forbidden" });
  });
});

describe("tenant isolation", () => {
  it("cannot reach another business's records by id", async () => {
    const p = await product(owner, "Children's Cough Syrup", {}, 5);
    expect(await getProduct(rival.business.id, p)).toBeNull();
    await expect(move(rival, p, "set_count", 0)).rejects.toMatchObject({ code: "product_not_found" });
    expect(await qty(owner, p)).toBe(5);
    expect((await listOpenReviewItems(rival)).length).toBe(0);
  });
});

describe("stock engine transactions", () => {
  it("applies changes with an exact ledger", async () => {
    const p = await product(owner, "Milk 1 gal", { unit: "gallon", reorderThreshold: 5 });
    await move(owner, p, "receive", 12, { unitCost: 3 });
    await move(owner, p, "sale", 2);
    const c = await move(owner, p, "set_count", 7);
    expect(c.movement).toMatchObject({ quantityBefore: 10, quantityAfter: 7, quantityChange: -3, actorName: "Olivia Owner" });
    const ledger = await biz(owner.business.id).movements.where("productId", "==", p).get();
    expect(ledger.docs.reduce((s, d) => s + d.data().quantityChange, 0)).toBe(7);
  });

  it("is idempotent, including under concurrent duplicate submissions", async () => {
    const p = await product(owner, "Concurrent product");
    const k = key("offline");
    const results = await Promise.all(Array.from({ length: 5 }, () => move(owner, p, "receive", 3, { idempotencyKey: k })));
    expect(results.filter((r) => !r.duplicate)).toHaveLength(1);
    expect(await qty(owner, p)).toBe(3);
    await expect(move(owner, p, "sale", 1, { idempotencyKey: k })).rejects.toMatchObject({ code: "idempotency_conflict" });
  });

  it("serializes concurrent different changes without losing updates", async () => {
    const p = await product(owner, "Busy product", {}, 100);
    await Promise.all(Array.from({ length: 10 }, () => move(owner, p, "sale", 1)));
    expect(await qty(owner, p)).toBe(90);
  });

  it("deducts FEFO and refuses stale counts", async () => {
    const p = await product(owner, "Yogurt", { trackExpiry: true });
    await move(owner, p, "receive", 5, { batchNumber: "LATE", expiryDate: "2030-06-01" });
    await move(owner, p, "receive", 4, { batchNumber: "EARLY", expiryDate: "2030-01-01" });
    await move(owner, p, "sale", 6);
    const batches = await listBatches(owner.business.id, p, false);
    expect(batches.map((b) => [b.batchNumber, b.quantity])).toEqual([["EARLY", 0], ["LATE", 3]]);
    await expect(move(owner, p, "set_count", 1, { observedAt: new Date(Date.now() - 3_600_000).toISOString() })).rejects.toMatchObject({ code: "stale_observation" });
  });

  it("enforces employee limits and manager-only movement types", async () => {
    const p = await product(manager, "AA Batteries", { unit: "pack" }, 40);
    await expect(move(employee, p, "receive", 200)).rejects.toMatchObject({ code: "approval_required" });
    await expect(move(employee, p, "correction", 3)).rejects.toMatchObject({ code: "forbidden" });
    await move(employee, p, "set_count", 36);
    await expect(product(employee, "Employee product")).rejects.toMatchObject({ code: "forbidden" });
  });

  it("raises a low-stock alert once per day for managers only", async () => {
    const p = await product(manager, "Alerting product", { reorderThreshold: 10 }, 12);
    await move(manager, p, "sale", 5);
    await move(manager, p, "receive", 10);
    await move(manager, p, "sale", 12);
    const alerts = await biz(owner.business.id).notifications.where("link", "==", `/inventory/${p}`).get();
    const forManager = alerts.docs.filter((d) => d.data().userId === manager.userId).map((d) => d.data().type);
    expect(forManager).toEqual(["low_stock"]);
    expect(alerts.docs.some((d) => d.data().userId === employee.userId)).toBe(false);
  });

  it("protects products with history from deletion", async () => {
    const p = await product(owner, "Has history", {}, 1);
    await expect(deleteProduct(owner, p)).rejects.toMatchObject({ code: "has_history" });
    await setArchived(owner, p, true);
    await expect(move(owner, p, "receive", 1)).rejects.toMatchObject({ code: "product_archived" });
  });
});

describe("AI review queue", () => {
  async function suggest(ctx: AppContext, text: string) {
    const data = parseVoiceCommandLocally(text);
    const session = await biz(ctx.business.id).voiceSessions.add({ userId: ctx.userId, createdAt: new Date().toISOString() });
    return persistVoiceExtraction(ctx, session.id, { provider: "local", model: "rules-v1", rawText: JSON.stringify(data), result: parseModelJson(voiceExtractionSchema, JSON.stringify(data)), latencyMs: 1 });
  }

  it("turns speech into reviewable items and applies an employee's own item once", async () => {
    const p = await product(manager, "Hand Soap", {}, 9);
    const out = await suggest(employee, "we have seven hand soap left");
    const item = out.items[0];
    expect(item).toMatchObject({ matchedProductId: p, movementType: "set_count", baseQuantity: 7 });
    const applied = await applyReviewItem(employee, { id: item.id, productId: p, movementType: "set_count", baseQuantity: 7 });
    expect(applied.movement).toMatchObject({ source: "voice", reviewItemId: item.id, approvedBy: null });
    expect((await applyReviewItem(employee, { id: item.id, productId: p, movementType: "set_count", baseQuantity: 7 })).duplicate).toBe(true);
    expect(await qty(manager, p)).toBe(7);
  });

  it("routes large changes to managers and records the approver", async () => {
    const p = await product(manager, "Paper Towels", { unit: "pack" }, 100);
    const out = await suggest(employee, "we have ten paper towels left");
    const item = out.items[0];
    expect(item.requiresRole).toBe("manager");
    await expect(applyReviewItem(employee, { id: item.id, productId: p, movementType: "set_count", baseQuantity: 10 })).rejects.toMatchObject({ code: "approval_required" });
    const r = await applyReviewItem(manager, { id: item.id, productId: p, movementType: "set_count", baseQuantity: 12 });
    expect(r.movement).toMatchObject({ approvedBy: manager.userId, quantityAfter: 12 });
  });

  it("hides and protects suggestions between employees", async () => {
    const p = await product(manager, "Toothpaste", {}, 4);
    const item = (await suggest(employee, "we have three toothpaste left")).items[0];
    expect((await listOpenReviewItems(employee2)).some((r) => r.item.id === item.id)).toBe(false);
    expect((await listOpenReviewItems(manager)).some((r) => r.item.id === item.id)).toBe(true);
    await expect(applyReviewItem(employee2, { id: item.id, productId: p, movementType: "set_count", baseQuantity: 3 })).rejects.toMatchObject({ code: "forbidden" });
    await rejectReviewItem(employee, item.id, "wrong");
    await expect(applyReviewItem(employee, { id: item.id, productId: p, movementType: "set_count", baseQuantity: 3 })).rejects.toMatchObject({ code: "review_item_closed" });
  });
});

describe("purchase orders", () => {
  it("runs the approval and receiving lifecycle", async () => {
    const supplier = await saveSupplier(manager, { name: "Acme Wholesale", contactPerson: null, email: "orders@acme.test", phone: null, whatsappNumber: null, address: null, paymentTerms: null, notes: null });
    const p = await product(manager, "PO product", { costPrice: 1.5 });
    const po = await createPurchaseOrder(manager, { supplierId: supplier, items: [{ productId: p, quantity: 24, unitCost: 1.5 }], notes: null, generatedByAi: false });
    const created = (await getPurchaseOrder(owner.business.id, po))!;
    expect(created).toMatchObject({ poNumber: "PO-00001", status: "draft", subtotal: 36 });

    await expect(transitionPurchaseOrder(manager, po, "approve")).rejects.toMatchObject({ code: "forbidden" });
    await expect(transitionPurchaseOrder(manager, po, "mark_sent", "email")).rejects.toMatchObject({ code: "invalid_transition" });
    await transitionPurchaseOrder(owner, po, "approve");
    await expect(editDraft(manager, po, () => ({ notes: "x" }))).rejects.toMatchObject({ code: "purchase_order_locked" });
    await transitionPurchaseOrder(manager, po, "mark_sent", "email");

    const line = created.lines[0].id;
    await receivePoLine(manager, po, line, { quantity: 10, batchNumber: null, expiryDate: null, key: "delivery-1" });
    await receivePoLine(manager, po, line, { quantity: 10, batchNumber: null, expiryDate: null, key: "delivery-1" });
    expect((await getPurchaseOrder(owner.business.id, po))!.status).toBe("partially_received");
    await receivePoLine(manager, po, line, { quantity: 14, batchNumber: "LOT9", expiryDate: "2031-01-01", key: "delivery-2" });
    expect((await getPurchaseOrder(owner.business.id, po))!.status).toBe("received");
    expect(await qty(manager, p)).toBe(24);
  });
});

describe("dashboard, reports and rate limits", () => {
  it("computes the dashboard from records and hides money from employees", async () => {
    const d = await dashboardSummary(owner);
    expect(d.totalProducts).toBeGreaterThan(5);
    expect(d.trend).toHaveLength(30);
    expect(d.trend.at(-1)!.units).toBe(d.totalUnits);
    expect((await dashboardSummary(employee)).inventoryValue).toBeNull();
  });

  it("runs reports for managers and refuses employees", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const rows = await runReport(manager, "employee_activity", today, today);
    expect(rows.find((r) => r.employee === "Olivia Owner")).toBeTruthy();
    await expect(runReport(employee, "shrinkage", today, today)).rejects.toMatchObject({ code: "forbidden" });
  });

  it("rate limits per key", async () => {
    const k = key("rl");
    await rateLimit(k, 2, 60);
    await rateLimit(k, 2, 60);
    await expect(rateLimit(k, 2, 60)).rejects.toMatchObject({ code: "rate_limited" });
  });
});
