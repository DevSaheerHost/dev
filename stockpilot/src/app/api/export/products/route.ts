import { authedRoute } from "@/lib/api/handler";
import { csvResponse } from "@/lib/api/csv-response";
import { hasRole } from "@/lib/auth/session";
import { loadProducts } from "@/lib/data/catalog";

export const GET = authedRoute({ rateLimit: { name: "export", limit: 30, windowSeconds: 600 } }, async (_req, ctx) => {
  const manager = hasRole(ctx.role, "manager");
  const rows = (await loadProducts(ctx.business.id))
    .sort((a, b) => a.nameLower.localeCompare(b.nameLower))
    .map((p) => ({
      name: p.name, sku: p.sku, barcode: p.barcode, brand: p.brand, category: p.categoryName, unit: p.unit, quantity: p.quantity,
      reorder_threshold: p.reorderThreshold, reorder_quantity: p.reorderQuantity, ...(manager ? { cost_price: p.costPrice } : {}),
      selling_price: p.sellingPrice, storage_location: p.storageLocation, supplier: p.supplierName, stock_status: p.status, next_expiry: p.nextExpiry,
    }));
  return csvResponse(`inventory-${new Date().toISOString().slice(0, 10)}.csv`, rows);
});
