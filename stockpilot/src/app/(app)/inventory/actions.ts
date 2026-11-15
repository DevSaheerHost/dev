"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireContext, hasRole } from "@/lib/auth/session";
import { dbFailure, isoDateOrNull, optionalNumber, optionalText, zodFailure, type ActionResult } from "@/lib/actions";
import { parseProductImport, MAX_IMPORT_ROWS } from "@/lib/domain/csv";
import { STOCK_UNITS } from "@/lib/domain/units";

const productSchema = z.object({
  id: z.uuid().optional(),
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
  preferredSupplierId: z.preprocess((v) => (v === "" ? null : v), z.uuid().nullable().default(null)),
  locationId: z.preprocess((v) => (v === "" ? null : v), z.uuid().nullable().default(null)),
  trackExpiry: z.preprocess((v) => v === "on" || v === "true", z.boolean()),
  initialQuantity: optionalNumber(0),
  batchNumber: optionalText(64),
  expiryDate: isoDateOrNull,
});

async function ensureCategory(ctx: Awaited<ReturnType<typeof requireContext>>, name: string | null): Promise<string | null> {
  if (!name) return null;
  const { data: existing } = await ctx.supabase.from("product_categories").select("id").eq("business_id", ctx.business.id).ilike("name", name).maybeSingle();
  if (existing) return existing.id;
  const { data, error } = await ctx.supabase.from("product_categories").insert({ business_id: ctx.business.id, name }).select("id").single();
  if (error) throw error;
  return data.id;
}

export async function saveProduct(_: ActionResult<{ id: string }> | null, formData: FormData): Promise<ActionResult<{ id: string }>> {
  const ctx = await requireContext();
  if (!hasRole(ctx.role, "manager")) return { ok: false, error: "Only managers and owners can edit products." };
  const parsed = productSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return zodFailure(parsed.error);
  const p = parsed.data;

  let categoryId: string | null;
  try {
    categoryId = await ensureCategory(ctx, p.category);
  } catch (e) {
    return dbFailure(e as { message?: string });
  }

  const row = {
    name: p.name, sku: p.sku, barcode: p.barcode, brand: p.brand, category_id: categoryId, description: p.description,
    color: p.color, package_size: p.packageSize,
    synonyms: (p.synonyms ?? "").split(",").map((s) => s.trim()).filter(Boolean).slice(0, 30),
    cost_price: p.costPrice ?? 0, selling_price: p.sellingPrice ?? 0, unit: p.unit,
    reorder_threshold: p.reorderThreshold ?? 0, reorder_quantity: p.reorderQuantity,
    storage_location: p.storageLocation, preferred_supplier_id: p.preferredSupplierId, location_id: p.locationId,
    track_expiry: p.trackExpiry,
  };

  if (p.id) {
    const { error } = await ctx.supabase.from("products").update(row).eq("id", p.id).eq("business_id", ctx.business.id);
    if (error) return dbFailure(error);
    revalidatePath(`/inventory/${p.id}`);
    revalidatePath("/inventory");
    return { ok: true, data: { id: p.id }, message: "Product saved." };
  }

  const { data, error } = await ctx.supabase.from("products").insert({ ...row, business_id: ctx.business.id }).select("id").single();
  if (error || !data) return dbFailure(error);

  if (p.initialQuantity && p.initialQuantity > 0) {
    const { error: moveError } = await ctx.supabase.rpc("apply_stock_movement", {
      p_business_id: ctx.business.id,
      p_product_id: data.id,
      p_type: "initial",
      p_quantity: p.initialQuantity,
      p_idempotency_key: `initial:${data.id}`,
      p_source: "manual",
      p_reason: "Opening stock",
      p_batch_number: p.batchNumber,
      p_expiry_date: p.expiryDate,
      p_unit_cost: p.costPrice,
    });
    if (moveError) return { ok: false, error: `Product created, but the opening stock failed: ${dbFailure(moveError).error}` };
  }
  revalidatePath("/inventory");
  return { ok: true, data: { id: data.id }, message: "Product created." };
}

export async function setArchived(productId: string, archived: boolean): Promise<ActionResult> {
  const ctx = await requireContext();
  const id = z.uuid().safeParse(productId);
  if (!id.success) return { ok: false, error: "Invalid product." };
  const { error } = await ctx.supabase
    .from("products")
    .update({ archived_at: archived ? new Date().toISOString() : null })
    .eq("id", id.data)
    .eq("business_id", ctx.business.id);
  if (error) return dbFailure(error);
  revalidatePath("/inventory");
  revalidatePath(`/inventory/${id.data}`);
  return { ok: true, message: archived ? "Product archived." : "Product restored." };
}

/** Hard delete: owner only, and impossible once any stock history exists. */
export async function deleteProduct(productId: string): Promise<ActionResult> {
  const ctx = await requireContext();
  if (ctx.role !== "owner") return { ok: false, error: "Only the owner can delete products." };
  const id = z.uuid().safeParse(productId);
  if (!id.success) return { ok: false, error: "Invalid product." };
  const { count } = await ctx.supabase.from("inventory_movements").select("id", { count: "exact", head: true }).eq("product_id", id.data);
  if ((count ?? 0) > 0) return { ok: false, error: "This product has stock history, so it can't be deleted. Archive it instead to keep the audit trail." };
  const { error } = await ctx.supabase.from("products").delete().eq("id", id.data).eq("business_id", ctx.business.id);
  if (error) return dbFailure(error);
  revalidatePath("/inventory");
  return { ok: true, message: "Product deleted." };
}

const variantSchema = z.object({
  productId: z.uuid(),
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
  const v = parsed.data;
  const { error } = await ctx.supabase.from("product_variants").insert({
    business_id: ctx.business.id, product_id: v.productId, name: v.name, unit: v.unit,
    conversion_factor: v.conversionFactor, sku: v.sku, barcode: v.barcode,
  });
  if (error) return dbFailure(error);
  revalidatePath(`/inventory/${v.productId}`);
  return { ok: true, message: "Packaging added." };
}

export async function deleteVariant(variantId: string, productId: string): Promise<ActionResult> {
  const ctx = await requireContext();
  if (!z.uuid().safeParse(variantId).success) return { ok: false, error: "Invalid packaging." };
  const { error } = await ctx.supabase.from("product_variants").delete().eq("id", variantId).eq("business_id", ctx.business.id);
  if (error) return dbFailure(error);
  revalidatePath(`/inventory/${productId}`);
  return { ok: true };
}

export async function updateBatch(_: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const ctx = await requireContext();
  const parsed = z
    .object({ id: z.uuid(), productId: z.uuid(), batchNumber: optionalText(64), expiryDate: isoDateOrNull })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return zodFailure(parsed.error);
  const { error } = await ctx.supabase
    .from("inventory_batches")
    .update({ batch_number: parsed.data.batchNumber, expiry_date: parsed.data.expiryDate })
    .eq("id", parsed.data.id)
    .eq("business_id", ctx.business.id);
  if (error) return dbFailure(error);
  revalidatePath(`/inventory/${parsed.data.productId}`);
  revalidatePath("/expiring");
  return { ok: true, message: "Batch updated." };
}

export interface ImportSummary {
  created: number;
  skipped: { line: number; message: string }[];
  stockErrors: number;
}

/** CSV import. The file is re-parsed and re-validated on the server; client previews are never trusted. */
export async function importProducts(csv: string): Promise<ActionResult<ImportSummary>> {
  const ctx = await requireContext();
  if (!hasRole(ctx.role, "manager")) return { ok: false, error: "Only managers and owners can import products." };
  if (typeof csv !== "string" || csv.length > 5 * 1024 * 1024) return { ok: false, error: "The file is too large (max 5 MB)." };
  const preview = parseProductImport(csv);
  if (preview.valid.length === 0) return { ok: false, error: preview.errors[0]?.message ?? "No valid rows found." };
  if (preview.valid.length > MAX_IMPORT_ROWS) return { ok: false, error: "Too many rows." };

  const { data: existing } = await ctx.supabase.from("products").select("sku").eq("business_id", ctx.business.id).is("archived_at", null).not("sku", "is", null);
  const existingSkus = new Set((existing ?? []).map((r) => String(r.sku).toLowerCase()));

  const categoryIds = new Map<string, string | null>();
  const skipped = [...preview.errors];
  let created = 0;
  let stockErrors = 0;

  for (const { line, row } of preview.valid) {
    if (row.sku && existingSkus.has(row.sku.toLowerCase())) {
      skipped.push({ line, message: `SKU ${row.sku} already exists — skipped` });
      continue;
    }
    let categoryId: string | null = null;
    if (row.category) {
      if (!categoryIds.has(row.category.toLowerCase())) {
        try {
          categoryIds.set(row.category.toLowerCase(), await ensureCategory(ctx, row.category));
        } catch {
          categoryIds.set(row.category.toLowerCase(), null);
        }
      }
      categoryId = categoryIds.get(row.category.toLowerCase()) ?? null;
    }
    const { data, error } = await ctx.supabase
      .from("products")
      .insert({
        business_id: ctx.business.id, name: row.name, sku: row.sku ?? null, barcode: row.barcode ?? null, brand: row.brand ?? null,
        category_id: categoryId, description: row.description ?? null, unit: row.unit, cost_price: row.cost_price ?? 0,
        selling_price: row.selling_price ?? 0, reorder_threshold: row.reorder_threshold ?? 0, storage_location: row.storage_location ?? null,
        track_expiry: !!row.expiry_date,
      })
      .select("id")
      .single();
    if (error || !data) {
      skipped.push({ line, message: dbFailure(error).error });
      continue;
    }
    created++;
    if (row.quantity && row.quantity > 0) {
      const { error: moveError } = await ctx.supabase.rpc("apply_stock_movement", {
        p_business_id: ctx.business.id, p_product_id: data.id, p_type: "initial", p_quantity: row.quantity,
        p_idempotency_key: `import:${data.id}`, p_source: "import", p_reason: "CSV import",
        p_batch_number: row.batch_number ?? null, p_expiry_date: row.expiry_date ?? null, p_unit_cost: row.cost_price ?? null,
      });
      if (moveError) stockErrors++;
    }
  }
  revalidatePath("/inventory");
  return { ok: true, data: { created, skipped: skipped.sort((a, b) => a.line - b.line).slice(0, 200), stockErrors } };
}
