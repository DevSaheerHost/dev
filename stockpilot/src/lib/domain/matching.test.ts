import { describe, expect, it } from "vitest";
import { catalog } from "@/test/fixtures";
import { classifyMatch, diceSimilarity, matchProduct } from "./matching";

describe("product matching", () => {
  it("ranks 'that blue allergy medicine' to the blue cetirizine pack without auto-confirming", () => {
    const r = matchProduct("that blue allergy medicine", catalog);
    expect(r.best?.productId).toBe("p-cetirizine");
    expect(r.candidates.slice(0, 3).map((c) => c.productId).sort()).toEqual(["p-cetirizine", "p-fexo", "p-loratadine"]);
    expect(r.tier).not.toBe("strong");
  });

  it("is certain about exact barcodes and SKUs", () => {
    expect(matchProduct("041333424019", catalog)).toMatchObject({ tier: "strong", best: { productId: "p-aa", score: 1 } });
    expect(matchProduct("dur-aa4", catalog).best?.productId).toBe("p-aa");
  });

  it("matches everyday descriptions to the right SKU", () => {
    expect(matchProduct("Children's Cough Syrup", catalog).best?.productId).toBe("p-cough");
    expect(matchProduct("milk", catalog).best?.productId).toBe("p-milk");
    expect(matchProduct("AA batteries", catalog).best?.productId).toBe("p-aa");
    expect(matchProduct("kids cough medicine", catalog).best?.productId).toBe("p-cough");
  });

  it("gives a near-verbatim name a strong match", () => {
    const r = matchProduct("Fexofenadine 120mg", catalog);
    expect(r).toMatchObject({ tier: "strong", best: { productId: "p-fexo" } });
  });

  it("penalizes conflicting strengths", () => {
    const r = matchProduct("fexofenadine 180mg", catalog);
    expect(r.tier).not.toBe("strong");
  });

  it("asks the user to select when nothing fits", () => {
    const r = matchProduct("garden hose", catalog);
    expect(r.tier).toBe("select");
  });

  it("never reports a strong match for a near tie", () => {
    expect(classifyMatch([{ productId: "a", name: "A", score: 0.97, reasons: [] }, { productId: "b", name: "B", score: 0.95, reasons: [] }])).toBe("select");
    expect(classifyMatch([{ productId: "a", name: "A", score: 0.97, reasons: [] }, { productId: "b", name: "B", score: 0.5, reasons: [] }])).toBe("strong");
  });

  it("computes symmetric bigram similarity", () => {
    expect(diceSimilarity("milk", "milk")).toBe(1);
    expect(diceSimilarity("milk", "silk")).toBeCloseTo(diceSimilarity("silk", "milk"));
    expect(diceSimilarity("", "milk")).toBe(0);
  });
});
