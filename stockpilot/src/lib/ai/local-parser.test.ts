import { describe, expect, it } from "vitest";
import { findQuantity, parseVoiceCommandLocally, splitClauses } from "./local-parser";
import { voiceExtractionSchema } from "./schemas";

const NOW = new Date("2026-11-15T10:00:00Z");

describe("local voice parser", () => {
  it("extracts the spec example into three distinct actions", () => {
    const out = parseVoiceCommandLocally(
      "We have three boxes of children's cough syrup left, two gallons of milk expired yesterday, and four cases of AA batteries arrived today.",
      NOW,
    );
    expect(voiceExtractionSchema.safeParse(out).success).toBe(true);
    expect(out.actions).toHaveLength(3);
    expect(out.actions[0]).toMatchObject({ product_name: "Children's Cough Syrup", action: "set_stock", quantity: 3, unit: "boxes" });
    expect(out.actions[1]).toMatchObject({ product_name: "Milk", action: "report_expiry", quantity: 2, unit: "gallons", expiry_status: "expired", expiry_date: "2026-11-14" });
    expect(out.actions[2]).toMatchObject({ product_name: "AA Batteries", action: "receive_stock", quantity: 4, unit: "cases" });
  });

  it("never reads 'we have three left' as adding stock", () => {
    const [a] = parseVoiceCommandLocally("we have three left of the yogurt", NOW).actions;
    expect(a.action).toBe("set_stock");
    expect(a.quantity).toBe(3);
  });

  it("asks for clarification on 'we have five batteries'", () => {
    const out = parseVoiceCommandLocally("We have five batteries.", NOW);
    expect(out.actions[0]).toMatchObject({ action: "unclear", quantity: 5, product_name: "Batteries" });
    expect(out.clarification_questions[0]).toBe("Do you mean five batteries are currently available, or five new batteries have arrived?");
    expect(out.overall_confidence).toBeLessThan(0.5);
  });

  it("recognizes sales, damage, missing stock, transfers and batches", () => {
    const out = parseVoiceCommandLocally(
      "sold twelve bottles of water; 3 jars of honey are broken; two razors are missing; moved six boxes of tissues to the back room; received 20 bottles of saline batch LX-42",
      NOW,
    );
    expect(out.actions.map((a) => a.action)).toEqual(["sell_stock", "report_damage", "report_missing", "transfer_stock", "receive_stock"]);
    expect(out.actions[3]).toMatchObject({ to_location: "Back Room", product_name: "Tissues", quantity: 6 });
    expect(out.actions[4]).toMatchObject({ batch_number: "LX-42", quantity: 20, product_name: "Saline" });
  });

  it("asks how many when the quantity is missing", () => {
    const [a] = parseVoiceCommandLocally("the bread arrived", NOW).actions;
    expect(a.quantity).toBeNull();
    expect(a.clarification_question).toMatch(/How many/);
  });

  it("does not invent an expiry date", () => {
    const [a] = parseVoiceCommandLocally("two cartons of eggs expired", NOW).actions;
    expect(a.expiry_date).toBeNull();
    expect(a.expiry_status).toBe("expired");
  });

  it("reports nothing for unrelated speech", () => {
    const out = parseVoiceCommandLocally("hello, testing", NOW);
    expect(out.actions.every((a) => a.action === "unclear")).toBe(true);
    expect(out.clarification_questions.length).toBeGreaterThan(0);
  });

  it("parses spoken numbers", () => {
    expect(findQuantity("twenty four packs".split(" "))?.value).toBe(24);
    expect(findQuantity("a dozen eggs".split(" "))?.value).toBe(12);
    expect(findQuantity("a case of".split(" "))?.value).toBe(1);
    expect(findQuantity("1.5 kg".split(" "))?.value).toBe(1.5);
  });

  it("splits clauses on punctuation and 'and' before a new quantity", () => {
    expect(splitClauses("three milk left and two bread arrived, also one soap sold")).toEqual(["three milk left", "two bread arrived", "one soap sold"]);
  });
});
