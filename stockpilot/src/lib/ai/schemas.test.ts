import { describe, expect, it } from "vitest";
import { parseModelJson, photoExtractionSchema, voiceExtractionSchema } from "./schemas";

const action = {
  product_name: "AA Batteries", action: "receive_stock", quantity: 4, unit: "case", expiry_status: null,
  expiry_date: null, batch_number: null, to_location: null, confidence: 0.92, evidence: "four cases arrived",
  clarification_question: null,
};

describe("AI output validation", () => {
  it("accepts well-formed output", () => {
    const r = parseModelJson(voiceExtractionSchema, JSON.stringify({ actions: [action], clarification_questions: [], overall_confidence: 0.92 }));
    expect(r.ok).toBe(true);
  });

  it("rejects non-JSON, unknown actions, out-of-range confidence and bad dates", () => {
    expect(parseModelJson(voiceExtractionSchema, "Sure! Here is the JSON:")).toEqual({ ok: false, error: "Model returned invalid JSON." });
    const bad = (patch: object) =>
      parseModelJson(voiceExtractionSchema, JSON.stringify({ actions: [{ ...action, ...patch }], clarification_questions: [], overall_confidence: 0.9 }));
    expect(bad({ action: "delete_all_products" }).ok).toBe(false);
    expect(bad({ confidence: 1.5 }).ok).toBe(false);
    expect(bad({ expiry_date: "next tuesday" }).ok).toBe(false);
    expect(bad({ quantity: "lots" }).ok).toBe(false);
    expect(bad({ product_name: "" }).ok).toBe(false);
  });

  it("drops unexpected fields smuggled into the output", () => {
    const r = parseModelJson(
      voiceExtractionSchema,
      JSON.stringify({ actions: [{ ...action, sql: "drop table products" }], clarification_questions: [], overall_confidence: 0.9, admin: true }),
    );
    expect(r.ok && JSON.stringify(r.data)).not.toMatch(/drop table|admin/);
  });

  it("validates photo extractions including quantity kinds", () => {
    const ok = parseModelJson(photoExtractionSchema, JSON.stringify({
      image_kind: "shelf",
      detected_products: [{ product_name: "AA Batteries", brand: "Duracell", quantity: 12, quantity_kind: "visible", unit: null, confidence: 0.94, expiry_date: null, batch_number: null, condition: "ok", notes: "Twelve visible packages detected" }],
      document: null, warnings: [], overall_confidence: 0.94,
    }));
    expect(ok.ok).toBe(true);
    const bad = parseModelJson(photoExtractionSchema, JSON.stringify({ image_kind: "shelf", detected_products: [{ product_name: "x", quantity_kind: "exact_total" }], document: null, warnings: [], overall_confidence: 1 }));
    expect(bad.ok).toBe(false);
  });
});
