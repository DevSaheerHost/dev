"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireContext } from "@/lib/auth/session";
import { attempt, isoDateOrNull, optionalNumber, optionalText, zodFailure, type ActionResult } from "@/lib/actions";
import * as catalog from "@/lib/data/catalog";
import { parseProductImport, MAX_IMPORT_ROWS } from "@/lib/domain/csv";
import { STOCK_UNITS } from "@/lib/domain/units";
import { AppError } from "@/lib/errors";

const docIdOrNull = z.preprocess((v) => (v === "" || v == null ? null : v), z.string().regex(/^[A-Za-z0-9_-]{8,64}$/).nullable().default(null));

const productSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/).optional(),
  name: z.string().trim().min(1, "Name is required.").max(200),
  sku: optionalText(64),
  barcode: optionalText(64).refine((v) => !v || /^[0-9A-Za-z-]{4,64}$/.test(v), "4–64 letters, digits or dashes."),
  brand: optionalText(120),
  category: optionalText(80),
  description: optionalText(2000),
  color: optionalText(40),
  packageSize: optionalText(60),
  synonyms: optionalText(600),
  costPrice: optionalNumber(0, 10_000_000),
  sellingPrice: optionalNumber(0, 10_000_000),
  unit: z.enum(STOCK_UNITS),
  reorderThreshold: optionalNumber(0),
  reorderQuantity: optionalNumber(0.001),
  storageLocation: optionalText(120),
  preferredSupplierId: docIdOrNull,
  locationId: docIdOrNull,
  trackExpiry: z.preprocess((v) => v === "on" || v === "true", z.boolean()),
  initialQuantity: optionalNumber(0),
  batchNumber: optionalText(64),
  expiryDate: isoDateOrNull,
});

export async function saveProduct(_: ActionResult<{ id: string }> | null, formData: FormData): Promise<ActionResult<{ id: string }>> {
  const ctx = await requireContext();
  const parsed = productSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return zodFailure(parsed.error);
  const p = parsed.data;
  const input: catalog.ProductInput = {
    name: p.name, sku: p.sku, barcode: p.barcode, brand: p.brand, category: p.category, description: p.description, color: p.color,
    packageSize: p.packageSize, synonyms: (p.synonyms ?? "").split(",").map((s) => s.trim()).filter(Boolean).slice(0, 30),
    costPrice: p.costPrice ?? 0, sellingPrice: p.sellingPrice ?? 0, unit: p.unit, reorderThreshold: p.reorderThreshold ?? 0,
    reorderQuantity: p.reorderQuantity, storageLocation: p.storageLocation, preferredSupplierId: p.preferredSupplierId,
    locationId: p.locationId, trackExpiry: p.trackExpiry,
  };
  const result = await attempt(async () => {
    if (p.id) {
      await catalog.updateProduct(ctx, p.id, input);
      return { id: p.id };
    }
    return { id: await catalog.createProduct(ctx, input, p.initialQuantity ? { quantity: p.initialQuantity, batchNumber: p.batchNumber, expiryDate: p.expiryDate } : undefined) };
  }, p.id ? "Product saved." : "Product created.");
  revalidatePath("/inventory");
  return result;
}

export async function setArchived(productId: string, archived: boolean): Promise<ActionResult> {
  const ctx = await requireContext();
  const r = await attempt(() => catalog.setArchived(ctx, productId, archived), archived ? "Product archived." : "Product restored.");
  revalidatePath("/inventory");
  return r;
}

export async function deleteProduct(productId: string): Promise<ActionResult> {
  const ctx = await requireContext();
  const r = await attempt(() => catalog.deleteProduct(ctx, productId), "Product deleted.");
  revalidatePath("/inventory");
  return r;
}

const variantSchema = z.object({
  productId: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/),
  name: z.string().trim().min(1, "Name is required.").max(120),
  unit: z.enum(STOCK_UNITS),
  conversionFactor: z.coerce.number().positive("Must be more than 0.").max(100000),
  sku: optionalText(64),
  barcode: optionalText(64).refine((v) => !v || /^[0-9A-Za-z-]{4,64}$/.test(v), "Invalid barcode."),
});

export async function addVariant(_: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const ctx = await requireContext();
  const parsed = variantSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return zodFailure(parsed.error);
  const { productId, ...v } = parsed.data;
  const r = await attempt(() => catalog.addVariant(ctx, productId, v), "Packaging added.");
  revalidatePath(`/inventory/${productId}`);
  return r;
}

export async function deleteVariant(variantId: string, productId: string): Promise<ActionResult> {
  const ctx = await requireContext();
  const r = await attempt(() => catalog.deleteVariant(ctx, productId, variantId));
  revalidatePath(`/inventory/${productId}`);
  return r;
}

export async function updateBatch(_: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const ctx = await requireContext();
  const parsed = z
    .object({ id: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/), productId: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/), batchNumber: optionalText(64), expiryDate: isoDateOrNull })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return zodFailure(parsed.error);
  const r = await attempt(() => catalog.updateBatchMeta(ctx, parsed.data.id, { batchNumber: parsed.data.batchNumber, expiryDate: parsed.data.expiryDate }), "Batch updated.");
  revalidatePath(`/inventory/${parsed.data.productId}`);
  revalidatePath("/expiring");
  return r;
}

export interface ImportSummary {
  created: number;
  skipped: { line: number; message: string }[];
  stockErrors: number;
}

/** CSV import. The file is re-parsed and re-validated on the server; client previews are never trusted. */
export async function importProducts(csv: string): Promise<ActionResult<ImportSummary>> {
  const ctx = await requireContext();
  if (ctx.role === "employee") return { ok: false, error: "Only managers and owners can import products." };
  if (typeof csv !== "string" || csv.length > 5 * 1024 * 1024) return { ok: false, error: "The file is too large (max 5 MB)." };
  const preview = parseProductImport(csv);
  if (preview.valid.length === 0) return { ok: false, error: preview.errors[0]?.message ?? "No valid rows found." };
  if (preview.valid.length > MAX_IMPORT_ROWS) return { ok: false, error: "Too many rows." };

  const skipped = [...preview.errors];
  let created = 0;
  let stockErrors = 0;
  for (const { line, row } of preview.valid) {
    try {
      await catalog.createProduct(
        ctx,
        {
          name: row.name, sku: row.sku ?? null, barcode: row.barcode ?? null, brand: row.brand ?? null, category: row.category ?? null,
          description: row.description ?? null, color: null, packageSize: null, synonyms: [], costPrice: row.cost_price ?? 0,
          sellingPrice: row.selling_price ?? 0, unit: row.unit, reorderThreshold: row.reorder_threshold ?? 0, reorderQuantity: null,
          storageLocation: row.storage_location ?? null, preferredSupplierId: null, locationId: null, trackExpiry: !!row.expiry_date,
        },
        row.quantity ? { quantity: row.quantity, batchNumber: row.batch_number ?? null, expiryDate: row.expiry_date ?? null } : undefined,
      );
      created++;
    } catch (e) {
      if (e instanceof AppError && e.code !== "duplicate" && e.message.includes("opening")) stockErrors++;
      skipped.push({ line, message: e instanceof AppError ? e.message : "Couldn't import this row." });
    }
  }
  revalidatePath("/inventory");
  return { ok: true, data: { created, skipped: skipped.sort((a, b) => a.line - b.line).slice(0, 200), stockErrors } };
}
