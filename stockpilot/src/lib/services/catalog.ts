import "server-only";
import type { AppContext } from "@/lib/auth/session";
import type { CatalogProduct } from "@/lib/domain/proposals";
import type { StockUnit } from "@/lib/domain/units";

const MAX_CATALOG = 5000;

/** Loads the active catalog (with packagings and live batches) for matching. */
export async function loadCatalog(ctx: AppContext): Promise<CatalogProduct[]> {
  const { data: products, error } = await ctx.supabase
    .from("products")
    .select("id, name, sku, barcode, brand, description, color, package_size, synonyms, unit, current_quantity, product_categories(name)")
    .eq("business_id", ctx.business.id)
    .is("archived_at", null)
    .limit(MAX_CATALOG);
  if (error) throw error;
  const ids = (products ?? []).map((p) => p.id as string);
  if (ids.length === 0) return [];

  const [{ data: variants }, { data: batches }] = await Promise.all([
    ctx.supabase.from("product_variants").select("product_id, name, unit, conversion_factor").eq("business_id", ctx.business.id),
    ctx.supabase
      .from("inventory_batches")
      .select("id, product_id, batch_number, expiry_date, quantity")
      .eq("business_id", ctx.business.id)
      .gt("quantity", 0),
  ]);

  return (products ?? []).map((p) => ({
    id: p.id,
    name: p.name,
    sku: p.sku,
    barcode: p.barcode,
    brand: p.brand,
    description: p.description,
    color: p.color,
    packageSize: p.package_size,
    synonyms: p.synonyms,
    category: (p.product_categories as unknown as { name: string } | null)?.name ?? null,
    unit: p.unit as StockUnit,
    currentQuantity: Number(p.current_quantity),
    variants: (variants ?? [])
      .filter((v) => v.product_id === p.id)
      .map((v) => ({ name: v.name, unit: v.unit as StockUnit, conversionFactor: Number(v.conversion_factor) })),
    batches: (batches ?? [])
      .filter((b) => b.product_id === p.id)
      .map((b) => ({ id: b.id, batchNumber: b.batch_number, expiryDate: b.expiry_date, quantity: Number(b.quantity) })),
  }));
}
