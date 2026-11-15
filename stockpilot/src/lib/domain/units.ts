/**
 * Units of measure and conversion.
 *
 * Rules
 *  - Mass (gram/kilogram) and volume (milliliter/liter/gallon) convert physically.
 *  - Package units (piece, box, pack, bottle, case) NEVER convert implicitly.
 *    A "case" only becomes pieces when the product defines a variant saying
 *    how many base units it contains.
 */

export const STOCK_UNITS = [
  "piece",
  "box",
  "pack",
  "bottle",
  "kilogram",
  "gram",
  "liter",
  "milliliter",
  "gallon",
  "case",
] as const;

export type StockUnit = (typeof STOCK_UNITS)[number];

export const UNIT_LABELS: Record<StockUnit, { singular: string; plural: string; short: string }> = {
  piece: { singular: "piece", plural: "pieces", short: "pc" },
  box: { singular: "box", plural: "boxes", short: "box" },
  pack: { singular: "pack", plural: "packs", short: "pk" },
  bottle: { singular: "bottle", plural: "bottles", short: "btl" },
  kilogram: { singular: "kilogram", plural: "kilograms", short: "kg" },
  gram: { singular: "gram", plural: "grams", short: "g" },
  liter: { singular: "liter", plural: "liters", short: "L" },
  milliliter: { singular: "milliliter", plural: "milliliters", short: "mL" },
  gallon: { singular: "gallon", plural: "gallons", short: "gal" },
  case: { singular: "case", plural: "cases", short: "cs" },
};

const UNIT_ALIASES: Record<string, StockUnit> = {
  piece: "piece", pieces: "piece", pc: "piece", pcs: "piece", ea: "piece", each: "piece",
  unit: "piece", units: "piece", item: "piece", items: "piece", count: "piece", ct: "piece",
  box: "box", boxes: "box", bx: "box", carton: "box", cartons: "box",
  pack: "pack", packs: "pack", pk: "pack", packet: "pack", packets: "pack", package: "pack", packages: "pack",
  bottle: "bottle", bottles: "bottle", btl: "bottle", btls: "bottle",
  kilogram: "kilogram", kilograms: "kilogram", kg: "kilogram", kgs: "kilogram", kilo: "kilogram", kilos: "kilogram",
  gram: "gram", grams: "gram", g: "gram", gm: "gram", gms: "gram",
  liter: "liter", liters: "liter", litre: "liter", litres: "liter", l: "liter", ltr: "liter",
  milliliter: "milliliter", milliliters: "milliliter", millilitre: "milliliter", millilitres: "milliliter", ml: "milliliter",
  gallon: "gallon", gallons: "gallon", gal: "gallon", gals: "gallon",
  case: "case", cases: "case", cs: "case", crate: "case", crates: "case",
};

/** Map free text ("boxes", "Kg", "litres") to a canonical unit, or null if unknown. */
export function normalizeUnit(raw: string | null | undefined): StockUnit | null {
  if (!raw) return null;
  const key = raw.trim().toLowerCase().replace(/\.$/, "");
  return UNIT_ALIASES[key] ?? null;
}

export function isStockUnit(value: unknown): value is StockUnit {
  return typeof value === "string" && (STOCK_UNITS as readonly string[]).includes(value);
}

type Dimension = "mass" | "volume" | "package";

const PHYSICAL: Partial<Record<StockUnit, { dimension: Exclude<Dimension, "package">; factor: number }>> = {
  gram: { dimension: "mass", factor: 1 },
  kilogram: { dimension: "mass", factor: 1000 },
  milliliter: { dimension: "volume", factor: 1 },
  liter: { dimension: "volume", factor: 1000 },
  gallon: { dimension: "volume", factor: 3785.411784 }, // US liquid gallon
};

export function unitDimension(unit: StockUnit): Dimension {
  return PHYSICAL[unit]?.dimension ?? "package";
}

export interface VariantConversion {
  name: string;
  unit: StockUnit;
  /** Base units contained in one of this variant. */
  conversionFactor: number;
}

export interface ConversionTarget {
  unit: StockUnit;
  variants?: VariantConversion[];
}

export type ConversionResult =
  | { ok: true; quantity: number; via: "same" | "physical" | "variant"; note?: string }
  | { ok: false; reason: string };

const round3 = (n: number) => Math.round(n * 1000) / 1000;

/**
 * Convert a quantity expressed in `from` into the product's base unit.
 * Fails (never guesses) when no safe conversion exists.
 */
export function convertToBase(quantity: number, from: StockUnit | null, product: ConversionTarget): ConversionResult {
  if (!Number.isFinite(quantity) || quantity < 0) {
    return { ok: false, reason: "Quantity must be a non-negative number." };
  }
  if (from === null || from === product.unit) {
    return { ok: true, quantity: round3(quantity), via: "same" };
  }

  const variant = product.variants?.find((v) => v.unit === from);
  if (variant) {
    return {
      ok: true,
      quantity: round3(quantity * variant.conversionFactor),
      via: "variant",
      note: `1 ${UNIT_LABELS[from].singular} = ${variant.conversionFactor} ${UNIT_LABELS[product.unit].plural} (${variant.name})`,
    };
  }

  const a = PHYSICAL[from];
  const b = PHYSICAL[product.unit];
  if (a && b && a.dimension === b.dimension) {
    return { ok: true, quantity: round3((quantity * a.factor) / b.factor), via: "physical" };
  }

  return {
    ok: false,
    reason: `This product is counted in ${UNIT_LABELS[product.unit].plural}, and no conversion from ${
      UNIT_LABELS[from].plural
    } is defined. Add a "${UNIT_LABELS[from].singular}" packaging to the product, or enter the quantity in ${
      UNIT_LABELS[product.unit].plural
    }.`,
  };
}

export function formatQuantity(quantity: number, unit: StockUnit): string {
  const q = round3(quantity);
  const label = q === 1 ? UNIT_LABELS[unit].singular : UNIT_LABELS[unit].plural;
  return `${q.toLocaleString("en-US", { maximumFractionDigits: 3 })} ${label}`;
}
