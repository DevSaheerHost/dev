import "server-only";
import { cache } from "react";
import type { AppContext } from "@/lib/auth/session";
import { AppError, invalid, notFound } from "@/lib/errors";
import { db } from "@/lib/firebase/admin";
import { isDocId, newId } from "@/lib/firebase/ids";
import type { CatalogProduct } from "@/lib/domain/proposals";
import { stockStatus } from "@/lib/domain/reorder";
import type { StockUnit } from "@/lib/domain/units";
import { assertRole } from "./business";
import type { BatchDoc, ProductDoc, VariantDoc } from "./model";
import { logActivity } from "./notify";
import { biz, nowIso } from "./refs";
import { applyMovement } from "./stock";

export const MAX_CATALOG = 5000;
export type ProductRow = ProductDoc & { id: string; status: "ok" | "low_stock" | "out_of_stock"; nextExpiry: string | null; supplierName: string | null };

/** Active (or archived) catalog for one business, loaded once per request. */
export const loadProducts = cache(async (businessId: string, archived = false): Promise<ProductRow[]> => {
  const ref = biz(businessId);
  const [products, batches, suppliers] = await Promise.all([
    ref.products.where("archivedAt", archived ? "!=" : "==", null).limit(MAX_CATALOG).get(),
    ref.batches.where("quantity", ">", 0).get(),
    ref.suppliers.get(),
  ]);
  const nextExpiry = new Map<string, string>();
  for (const b of batches.docs) {
    const { productId, expiryDate } = b.data();
    if (expiryDate && (!nextExpiry.has(productId) || expiryDate < nextExpiry.get(productId)!)) nextExpiry.set(productId, expiryDate);
  }
  const supplierName = new Map(suppliers.docs.map((s) => [s.id, s.data().name]));
  return products.docs.map((d) => {
    const p = d.data();
    return { ...p, id: d.id, status: stockStatus(p.quantity, p.reorderThreshold), nextExpiry: nextExpiry.get(d.id) ?? null, supplierName: p.preferredSupplierId ? supplierName.get(p.preferredSupplierId) ?? null : null };
  });
});

export async function getProduct(businessId: string, id: string): Promise<(ProductDoc & { id: string }) | null> {
  if (!isDocId(id)) return null;
  const snap = await biz(businessId).products.doc(id).get();
  return snap.exists ? { ...snap.data()!, id } : null;
}

export async function listBatches(businessId: string, productId?: string, onlyInStock = true) {
  let q = biz(businessId).batches as FirebaseFirestore.Query<BatchDoc>;
  if (productId) q = q.where("productId", "==", productId);
  const snap = await q.get();
  return snap.docs
    .map((d) => ({ ...d.data(), id: d.id }))
    .filter((b) => !onlyInStock || b.quantity > 0)
    .sort((a, b) => (a.expiryDate ?? "9999").localeCompare(b.expiryDate ?? "9999"));
}

export async function listCategories(businessId: string) {
  const snap = await biz(businessId).categories.orderBy("nameLower").get();
  return snap.docs.map((d) => ({ id: d.id, name: d.data().name }));
}

async function ensureCategory(businessId: string, name: string | null): Promise<{ id: string | null; name: string | null }> {
  if (!name) return { id: null, name: null };
  const ref = biz(businessId).categories;
  const existing = await ref.where("nameLower", "==", name.toLowerCase()).limit(1).get();
  if (!existing.empty) return { id: existing.docs[0].id, name: existing.docs[0].data().name };
  const doc = await ref.add({ name, nameLower: name.toLowerCase(), createdAt: nowIso() });
  return { id: doc.id, name };
}

export interface ProductInput {
  name: string; sku: string | null; barcode: string | null; brand: string | null; category: string | null; description: string | null;
  color: string | null; packageSize: string | null; synonyms: string[]; costPrice: number; sellingPrice: number; unit: StockUnit;
  reorderThreshold: number; reorderQuantity: number | null; storageLocation: string | null; preferredSupplierId: string | null;
  locationId: string | null; trackExpiry: boolean;
}

async function assertUniqueIdentifiers(businessId: string, input: { sku: string | null; barcode: string | null }, exceptId?: string) {
  const ref = biz(businessId).products;
  if (input.sku) {
    const s = await ref.where("skuLower", "==", input.sku.toLowerCase()).where("archivedAt", "==", null).limit(2).get();
    if (s.docs.some((d) => d.id !== exceptId)) throw new AppError(409, "duplicate", `Another product already uses SKU ${input.sku}.`);
  }
  if (input.barcode) {
    const b = await ref.where("barcode", "==", input.barcode).where("archivedAt", "==", null).limit(2).get();
    if (b.docs.some((d) => d.id !== exceptId)) throw new AppError(409, "duplicate", `Another product already uses barcode ${input.barcode}.`);
  }
}

async function assertReferences(businessId: string, input: { preferredSupplierId: string | null; locationId: string | null }) {
  const ref = biz(businessId);
  if (input.preferredSupplierId && !(isDocId(input.preferredSupplierId) && (await ref.suppliers.doc(input.preferredSupplierId).get()).exists)) throw invalid("Unknown supplier.");
  if (input.locationId && !(isDocId(input.locationId) && (await ref.locations.doc(input.locationId).get()).exists)) throw invalid("Unknown location.");
}

export async function createProduct(ctx: AppContext, input: ProductInput, opening?: { quantity: number; batchNumber: string | null; expiryDate: string | null }): Promise<string> {
  assertRole(ctx, "manager", "Only managers and owners can add products.");
  await assertUniqueIdentifiers(ctx.business.id, input);
  await assertReferences(ctx.business.id, input);
  const category = await ensureCategory(ctx.business.id, input.category);
  const id = newId();
  const now = nowIso();
  await biz(ctx.business.id).products.doc(id).create({
    ...input, nameLower: input.name.toLowerCase(), skuLower: input.sku?.toLowerCase() ?? null, categoryId: category.id, categoryName: category.name,
    quantity: 0, variants: [], lastCountedAt: null, lastMovementAt: null, archivedAt: null, createdAt: now, updatedAt: now,
  });
  if (opening && opening.quantity > 0) {
    await applyMovement(ctx.business.id, ctx.business, { userId: ctx.userId, name: ctx.fullName, role: ctx.role }, {
      productId: id, type: "initial", quantity: opening.quantity, source: "manual", idempotencyKey: `initial:${id}`, reason: "Opening stock",
      batchNumber: opening.batchNumber, expiryDate: opening.expiryDate, unitCost: input.costPrice || null,
    });
  }
  return id;
}

export async function updateProduct(ctx: AppContext, id: string, input: ProductInput) {
  assertRole(ctx, "manager", "Only managers and owners can edit products.");
  if (!isDocId(id)) throw notFound("Product");
  await assertUniqueIdentifiers(ctx.business.id, input, id);
  await assertReferences(ctx.business.id, input);
  const category = await ensureCategory(ctx.business.id, input.category);
  const ref = biz(ctx.business.id).products.doc(id);
  if (!(await ref.get()).exists) throw notFound("Product");
  // quantity, costPrice history and timestamps are never client-editable.
  const { costPrice, ...rest } = input;
  await ref.update({ ...rest, costPrice, nameLower: input.name.toLowerCase(), skuLower: input.sku?.toLowerCase() ?? null, categoryId: category.id, categoryName: category.name, updatedAt: nowIso() });
}

export async function setArchived(ctx: AppContext, id: string, archived: boolean) {
  assertRole(ctx, "manager");
  const ref = biz(ctx.business.id).products.doc(id);
  if (!isDocId(id) || !(await ref.get()).exists) throw notFound("Product");
  await ref.update({ archivedAt: archived ? nowIso() : null, updatedAt: nowIso() });
  await logActivity(ctx.business.id, ctx.userId, archived ? "product.archived" : "product.restored", "product", id);
}

/** Hard delete: owner only, and only for products that never had a stock movement. */
export async function deleteProduct(ctx: AppContext, id: string) {
  assertRole(ctx, "owner", "Only the owner can delete products.");
  if (!isDocId(id)) throw notFound("Product");
  const ref = biz(ctx.business.id);
  const history = await ref.movements.where("productId", "==", id).limit(1).get();
  if (!history.empty) throw new AppError(409, "has_history", "This product has stock history, so it can't be deleted. Archive it instead to keep the audit trail.");
  await ref.products.doc(id).delete();
  await logActivity(ctx.business.id, ctx.userId, "product.deleted", "product", id);
}

export async function addVariant(ctx: AppContext, productId: string, v: Omit<VariantDoc, "id">) {
  assertRole(ctx, "manager");
  const ref = biz(ctx.business.id).products.doc(productId);
  await db().runTransaction(async (tx) => {
    const p = (await tx.get(ref)).data();
    if (!p) throw notFound("Product");
    if (p.variants.length >= 20) throw invalid("Too many packagings.");
    if (p.variants.some((x) => x.unit === v.unit && x.name.toLowerCase() === v.name.toLowerCase())) throw new AppError(409, "duplicate", "That packaging already exists.");
    if (p.variants.some((x) => x.unit === v.unit)) throw new AppError(409, "duplicate", `A ${v.unit} packaging is already defined.`);
    tx.update(ref, { variants: [...p.variants, { ...v, id: newId() }], updatedAt: nowIso() });
  });
}

export async function deleteVariant(ctx: AppContext, productId: string, variantId: string) {
  assertRole(ctx, "manager");
  const ref = biz(ctx.business.id).products.doc(productId);
  await db().runTransaction(async (tx) => {
    const p = (await tx.get(ref)).data();
    if (!p) throw notFound("Product");
    tx.update(ref, { variants: p.variants.filter((x) => x.id !== variantId), updatedAt: nowIso() });
  });
}

export async function updateBatchMeta(ctx: AppContext, batchId: string, patch: { batchNumber: string | null; expiryDate: string | null }) {
  assertRole(ctx, "manager");
  const ref = biz(ctx.business.id).batches.doc(batchId);
  if (!isDocId(batchId) || !(await ref.get()).exists) throw notFound("Batch");
  await ref.update({ ...patch, updatedAt: nowIso() });
}

/** Catalog shaped for the matching/proposal engine. */
export async function loadCatalog(businessId: string): Promise<CatalogProduct[]> {
  const [products, batches] = await Promise.all([loadProducts(businessId), listBatches(businessId)]);
  return products.map((p) => ({
    id: p.id, name: p.name, sku: p.sku, barcode: p.barcode, brand: p.brand, description: p.description, color: p.color,
    packageSize: p.packageSize, synonyms: p.synonyms, category: p.categoryName, unit: p.unit, currentQuantity: p.quantity,
    variants: p.variants.map((v) => ({ name: v.name, unit: v.unit, conversionFactor: v.conversionFactor })),
    batches: batches.filter((b) => b.productId === p.id).map((b) => ({ id: b.id, batchNumber: b.batchNumber, expiryDate: b.expiryDate, quantity: b.quantity })),
  }));
}
