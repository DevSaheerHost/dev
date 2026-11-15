/** Realistic catalog fixtures for a small pharmacy / convenience store. */
import type { CatalogProduct } from "@/lib/domain/proposals";

export const catalog: CatalogProduct[] = [
  {
    id: "p-cough", name: "Children's Cough Syrup 100ml", brand: "Robitussin", category: "Cough & Cold",
    unit: "box", currentQuantity: 9, variants: [], synonyms: ["kids cough medicine"], color: "red",
  },
  {
    id: "p-milk", name: "Whole Milk 1 Gallon", brand: "Valley Farms", category: "Dairy", unit: "gallon",
    currentQuantity: 14, variants: [],
    batches: [
      { id: "b-milk-old", batchNumber: "VF-1102", expiryDate: "2026-11-14", quantity: 4 },
      { id: "b-milk-new", batchNumber: "VF-1120", expiryDate: "2026-11-28", quantity: 10 },
    ],
  },
  {
    id: "p-aa", name: "AA Alkaline Batteries 4-pack", brand: "Duracell", category: "Batteries", sku: "DUR-AA4",
    barcode: "041333424019", unit: "pack", currentQuantity: 6,
    variants: [{ name: "Case of 24 packs", unit: "case", conversionFactor: 24 }],
  },
  {
    id: "p-cetirizine", name: "Cetirizine 10mg Blue Pack", brand: "Zyrtec", category: "Allergy",
    description: "Antihistamine tablets, 30 count", color: "blue", unit: "box", currentQuantity: 12, variants: [],
  },
  {
    id: "p-loratadine", name: "Loratadine 10mg", brand: "Claritin", category: "Allergy",
    description: "Non-drowsy antihistamine", color: "white", unit: "box", currentQuantity: 8, variants: [],
  },
  {
    id: "p-fexo", name: "Fexofenadine 120mg", brand: "Allegra", category: "Allergy",
    description: "24 hour allergy relief", color: "orange", unit: "box", currentQuantity: 5, variants: [],
  },
  {
    id: "p-rice", name: "Basmati Rice", brand: "Tilda", category: "Grocery", unit: "kilogram",
    currentQuantity: 40, variants: [],
  },
];

export const rules = { largeAdjustmentUnits: 50, largeAdjustmentPercent: 50 };
