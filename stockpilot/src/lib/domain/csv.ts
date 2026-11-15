/** RFC 4180 CSV parsing and spreadsheet-safe serialization. */
import { z } from "zod";
import { normalizeUnit, type StockUnit } from "./units";

export const MAX_IMPORT_ROWS = 5000;

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const input = text.replace(/^﻿/, "");

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (quoted) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
      continue;
    }
    if (ch === '"' && field === "") quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && input[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

/**
 * Serialize a cell. Values starting with = + - @ (or tab/CR) are prefixed so
 * spreadsheet apps never evaluate them as formulas (CSV injection).
 */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let s = value instanceof Date ? value.toISOString() : typeof value === "object" ? JSON.stringify(value) : String(value);
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: Record<string, unknown>[], columns?: string[]): string {
  const cols = columns ?? [...new Set(rows.flatMap((r) => Object.keys(r)))];
  return [cols.map(csvCell).join(","), ...rows.map((r) => cols.map((c) => csvCell(r[c])).join(","))].join("\r\n") + "\r\n";
}

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .optional();
const money = z.coerce.number().min(0).max(10_000_000).optional();

export const productImportRowSchema = z.object({
  name: z.string().trim().min(1, "name is required").max(200),
  sku: optionalText(64),
  barcode: optionalText(64).refine((v) => !v || /^[0-9A-Za-z-]{4,64}$/.test(v), "invalid barcode"),
  brand: optionalText(120),
  category: optionalText(80),
  description: optionalText(2000),
  unit: z
    .string()
    .trim()
    .optional()
    .transform((v, ctx): StockUnit => {
      if (!v) return "piece";
      const u = normalizeUnit(v);
      if (!u) {
        ctx.addIssue({ code: "custom", message: `unknown unit "${v}"` });
        return z.NEVER;
      }
      return u;
    }),
  cost_price: money,
  selling_price: money,
  quantity: z.coerce.number().min(0).max(10_000_000).optional(),
  reorder_threshold: z.coerce.number().min(0).max(10_000_000).optional(),
  storage_location: optionalText(120),
  batch_number: optionalText(64),
  expiry_date: optionalText(10).refine((v) => !v || /^\d{4}-\d{2}-\d{2}$/.test(v), "expiry_date must be YYYY-MM-DD"),
});
export type ProductImportRow = z.infer<typeof productImportRowSchema>;

const HEADER_ALIASES: Record<string, string> = {
  "product name": "name", product: "name", item: "name", title: "name",
  "cost": "cost_price", "cost price": "cost_price", "price": "selling_price", "selling price": "selling_price",
  "retail price": "selling_price", qty: "quantity", stock: "quantity", "current quantity": "quantity",
  "on hand": "quantity", "reorder level": "reorder_threshold", "reorder threshold": "reorder_threshold",
  "reorder point": "reorder_threshold", location: "storage_location", "storage location": "storage_location",
  batch: "batch_number", "batch number": "batch_number", lot: "batch_number", expiry: "expiry_date",
  "expiry date": "expiry_date", "expiration date": "expiry_date", upc: "barcode", ean: "barcode",
};

export interface ImportPreview {
  valid: { line: number; row: ProductImportRow }[];
  errors: { line: number; message: string }[];
}

export function parseProductImport(text: string): ImportPreview {
  const rows = parseCsv(text);
  if (rows.length === 0) return { valid: [], errors: [{ line: 1, message: "The file is empty." }] };
  if (rows.length - 1 > MAX_IMPORT_ROWS) {
    return { valid: [], errors: [{ line: 1, message: `Too many rows (max ${MAX_IMPORT_ROWS}).` }] };
  }
  const header = rows[0].map((h) => {
    const k = h.trim().toLowerCase().replace(/_/g, " ");
    return HEADER_ALIASES[k] ?? k.replace(/ /g, "_");
  });
  if (!header.includes("name")) return { valid: [], errors: [{ line: 1, message: 'A "name" column is required.' }] };

  const valid: ImportPreview["valid"] = [];
  const errors: ImportPreview["errors"] = [];
  const seenSku = new Set<string>();
  rows.slice(1).forEach((cells, i) => {
    const line = i + 2;
    const record: Record<string, string> = {};
    header.forEach((h, idx) => {
      if (h in productImportRowSchema.shape) record[h] = cells[idx] ?? "";
    });
    for (const k of Object.keys(record)) if (record[k].trim() === "" && k !== "name") delete record[k];
    const parsed = productImportRowSchema.safeParse(record);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      errors.push({ line, message: `${issue.path.join(".") || "row"}: ${issue.message}` });
      return;
    }
    const sku = parsed.data.sku?.toLowerCase();
    if (sku) {
      if (seenSku.has(sku)) {
        errors.push({ line, message: `duplicate sku "${parsed.data.sku}" in file` });
        return;
      }
      seenSku.add(sku);
    }
    valid.push({ line, row: parsed.data });
  });
  return { valid, errors };
}
