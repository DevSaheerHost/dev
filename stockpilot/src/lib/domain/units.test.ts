import { describe, expect, it } from "vitest";
import { convertToBase, formatQuantity, normalizeUnit } from "./units";

describe("units", () => {
  it("normalizes spoken and written unit names", () => {
    expect(normalizeUnit("Boxes")).toBe("box");
    expect(normalizeUnit("litres")).toBe("liter");
    expect(normalizeUnit("kg")).toBe("kilogram");
    expect(normalizeUnit("pcs")).toBe("piece");
    expect(normalizeUnit("bushels")).toBeNull();
  });

  it("converts physical units within the same dimension", () => {
    expect(convertToBase(2.5, "kilogram", { unit: "gram" })).toEqual({ ok: true, quantity: 2500, via: "physical" });
    expect(convertToBase(1, "gallon", { unit: "liter" })).toMatchObject({ ok: true, quantity: 3.785 });
  });

  it("never treats package units as interchangeable", () => {
    const r = convertToBase(4, "case", { unit: "pack" });
    expect(r.ok).toBe(false);
    expect(convertToBase(3, "liter", { unit: "kilogram" }).ok).toBe(false);
    expect(convertToBase(1, "box", { unit: "bottle" }).ok).toBe(false);
  });

  it("uses product variants for package conversion", () => {
    const r = convertToBase(4, "case", { unit: "pack", variants: [{ name: "Case of 24", unit: "case", conversionFactor: 24 }] });
    expect(r).toMatchObject({ ok: true, quantity: 96, via: "variant" });
  });

  it("treats a missing unit as the product's own unit and rejects bad quantities", () => {
    expect(convertToBase(3, null, { unit: "box" })).toEqual({ ok: true, quantity: 3, via: "same" });
    expect(convertToBase(-1, null, { unit: "box" }).ok).toBe(false);
    expect(convertToBase(Number.NaN, null, { unit: "box" }).ok).toBe(false);
  });

  it("formats quantities with singular and plural labels", () => {
    expect(formatQuantity(1, "box")).toBe("1 box");
    expect(formatQuantity(2.5, "kilogram")).toBe("2.5 kilograms");
  });
});
