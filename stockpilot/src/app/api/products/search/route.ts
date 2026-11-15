import { NextResponse } from "next/server";
import { authedRoute } from "@/lib/api/handler";
import { loadProducts } from "@/lib/data/catalog";
import { matchProduct } from "@/lib/domain/matching";

/** Product picker search: exact identifiers and fuzzy name matching over the business's catalog. */
export const GET = authedRoute({ rateLimit: { name: "search", limit: 300, windowSeconds: 60 } }, async (request, ctx) => {
  const q = (request.nextUrl.searchParams.get("q") ?? "").trim().slice(0, 100);
  const products = await loadProducts(ctx.business.id);
  const shape = (p: (typeof products)[number]) => ({ id: p.id, name: p.name, sku: p.sku, unit: p.unit, current_quantity: p.quantity });
  if (!q) return NextResponse.json({ products: [...products].sort((a, b) => a.nameLower.localeCompare(b.nameLower)).slice(0, 20).map(shape) });
  const lower = q.toLowerCase();
  const direct = products.filter((p) => p.nameLower.includes(lower) || p.skuLower === lower || p.barcode === q);
  const fuzzy = matchProduct(q, products, 20).candidates.map((c) => products.find((p) => p.id === c.productId)!);
  const merged = [...new Map([...direct, ...fuzzy].map((p) => [p.id, p])).values()].slice(0, 20);
  return NextResponse.json({ products: merged.map(shape) });
});
