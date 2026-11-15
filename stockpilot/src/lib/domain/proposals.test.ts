import { describe, expect, it } from "vitest";
import { parseVoiceCommandLocally } from "@/lib/ai/local-parser";
import { catalog, rules } from "@/test/fixtures";
import { buildProposal, fromDetectedProduct, fromVoiceAction, isApplicable, projectedChange } from "./proposals";

const NOW = new Date("2026-11-15T10:00:00Z");
const voice = (text: string, role: "owner" | "manager" | "employee" = "employee") =>
  parseVoiceCommandLocally(text, NOW).actions.map((a, i) => buildProposal(fromVoiceAction(a), i, catalog, rules, role));

describe("proposal policy", () => {
  it("turns the spec example into three applicable, correctly converted proposals", () => {
    const [cough, milk, aa] = voice(
      "We have three boxes of children's cough syrup left, two gallons of milk expired yesterday, and four cases of AA batteries arrived today.",
    );
    expect(cough).toMatchObject({ matchedProductId: "p-cough", movementType: "set_count", baseQuantity: 3, status: "pending" });
    expect(milk).toMatchObject({ matchedProductId: "p-milk", movementType: "expire", baseQuantity: 2, batchId: "b-milk-old", expiryDate: "2026-11-14" });
    expect(milk.riskLevel).toBe("medium");
    // 4 cases x 24 packs = 96 packs: a large change, so an employee needs a manager.
    expect(aa).toMatchObject({ matchedProductId: "p-aa", movementType: "receive", baseQuantity: 96, riskLevel: "high", requiresRole: "manager" });
    expect(aa.warnings.join(" ")).toMatch(/1 case = 24 packs/);
    expect([cough, milk, aa].every(isApplicable)).toBe(true);
  });

  it("does not require a manager when a manager reports the same change", () => {
    const [aa] = voice("four cases of AA batteries arrived", "manager");
    expect(aa.requiresRole).toBe("employee");
    expect(aa.riskLevel).toBe("high");
  });

  it("blocks unclear intent with the clarification question", () => {
    const [p] = voice("We have five batteries");
    expect(p.status).toBe("needs_clarification");
    expect(p.movementType).toBeNull();
    expect(p.clarificationQuestion).toMatch(/currently available, or five new batteries have arrived/);
    expect(isApplicable(p)).toBe(false);
  });

  it("refuses to convert between unrelated package units", () => {
    const [p] = voice("we have two cases of children's cough syrup left");
    expect(p.status).toBe("needs_clarification");
    expect(p.baseQuantity).toBeNull();
    expect(p.clarificationQuestion).toMatch(/no conversion from cases/);
  });

  it("converts physical units to the product unit", () => {
    const [p] = voice("received 5000 grams of basmati rice", "manager");
    expect(p).toMatchObject({ matchedProductId: "p-rice", baseQuantity: 5 });
  });

  it("flags removals larger than recorded stock", () => {
    const [p] = voice("ten boxes of fexofenadine 120mg are damaged", "owner");
    expect(p.status).toBe("needs_clarification");
    expect(p.clarificationQuestion).toMatch(/Only 5 boxes/);
  });

  it("requires the employee to pick a product for vague descriptions", () => {
    const [p] = voice("we have two left of that blue allergy medicine");
    expect(p.productNeedsSelection || p.match.tier === "suggest").toBe(true);
    expect(p.match.best?.productId).toBe("p-cetirizine");
    expect(p.riskLevel).not.toBe("low");
  });

  it("asks which product when the catalog has nothing similar", () => {
    const [p] = voice("we have four garden hoses left");
    expect(p.status).toBe("needs_clarification");
    expect(p.matchedProductId).toBeNull();
  });

  it("does not remove stock that is only expiring soon", () => {
    const [p] = voice("two gallons of milk expiring tomorrow");
    expect(p.movementType).toBeNull();
    expect(p.warnings.join(" ")).toMatch(/Nothing will be removed/);
  });

  it("routes corrections and transfers through a manager for employees", () => {
    const [p] = voice("correction: the loratadine count is off by two");
    expect(p.requiresRole).toBe("manager");
  });

  it("never turns a shelf photo's visible count into a stock count", () => {
    const p = buildProposal(
      fromDetectedProduct(
        { product_name: "AA Batteries", brand: "Duracell", quantity: 12, quantity_kind: "visible", unit: "pack", confidence: 0.94, expiry_date: null, batch_number: null, condition: "ok", notes: "Twelve visible packages" },
        "shelf",
      ),
      0, catalog, rules, "employee",
    );
    expect(p.movementType).toBeNull();
    expect(p.quantityKind).toBe("visible");
    expect(p.warnings.join(" ")).toMatch(/only show visible items/);
    expect(p.status).toBe("needs_clarification");
  });

  it("turns packing slip lines into receipts and flags low confidence", () => {
    const p = buildProposal(
      fromDetectedProduct(
        { product_name: "Loratadine 10mg", brand: null, quantity: 6, quantity_kind: "document", unit: "box", confidence: 0.62, expiry_date: "2028-03-01", batch_number: "L-77", condition: "ok", notes: "Line 3" },
        "packing_slip",
      ),
      0, catalog, rules, "manager",
    );
    expect(p).toMatchObject({ movementType: "receive", baseQuantity: 6, matchedProductId: "p-loratadine", batchNumber: "L-77", riskLevel: "medium" });
    expect(p.warnings.join(" ")).toMatch(/Low AI confidence \(62%\)/);
  });

  it("computes the signed effect of each movement type", () => {
    expect(projectedChange("set_count", 3, 9)).toBe(-6);
    expect(projectedChange("receive", 3, 9)).toBe(3);
    expect(projectedChange("missing", 2, 9)).toBe(-2);
    expect(projectedChange("transfer", 2, 9)).toBe(0);
  });
});
