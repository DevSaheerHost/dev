import { describe, expect, it } from "vitest";
import { csvCell, parseCsv, parseProductImport, toCsv } from "./csv";

describe("csv", () => {
  it("parses quoted fields, escaped quotes, CRLF and BOM", () => {
    expect(parseCsv('﻿name,notes\r\n"Milk, whole","says ""fresh"""\r\nEggs,\n')).toEqual([
      ["name", "notes"],
      ["Milk, whole", 'says "fresh"'],
      ["Eggs", ""],
    ]);
  });

  it("neutralizes spreadsheet formula injection on export", () => {
    expect(csvCell("=HYPERLINK(\"http://evil\")")).toBe("\"'=HYPERLINK(\"\"http://evil\"\")\"");
    expect(csvCell("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(csvCell("-5")).toBe("-5");
    expect(csvCell(null)).toBe("");
    expect(toCsv([{ a: 1, b: "x,y" }])).toBe('a,b\r\n1,"x,y"\r\n');
  });

  it("validates product imports row by row", () => {
    const preview = parseProductImport(
      [
        "Product Name,SKU,Unit,Qty,Cost,Reorder Level,Expiry Date",
        "AA Batteries,DUR-AA4,packs,12,4.50,10,",
        "Milk,MLK-1,gallons,5,3.10,6,2026-12-01",
        ",NOPE,piece,1,1,1,",
        "Rice,RICE,bushels,1,1,1,",
        "Dup,DUR-AA4,piece,1,1,1,",
        "Bad date,BD,piece,1,1,1,01/12/2026",
      ].join("\n"),
    );
    expect(preview.valid.map((v) => v.row)).toEqual([
      expect.objectContaining({ name: "AA Batteries", sku: "DUR-AA4", unit: "pack", quantity: 12, cost_price: 4.5, reorder_threshold: 10 }),
      expect.objectContaining({ name: "Milk", unit: "gallon", expiry_date: "2026-12-01" }),
    ]);
    expect(preview.errors.map((e) => e.line)).toEqual([4, 5, 6, 7]);
    expect(preview.errors[1].message).toMatch(/unknown unit/);
  });

  it("requires a name column", () => {
    expect(parseProductImport("sku,qty\nA,1").errors[0].message).toMatch(/name/);
  });
});
