import Link from "next/link";
import { Download, FileUp, Package, Plus, Search } from "lucide-react";
import { BarcodeScanButton } from "@/components/inventory/barcode-scan";
import { StockBadge } from "@/components/inventory/stock-badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Alert, EmptyState } from "@/components/ui/feedback";
import { Input, Select } from "@/components/ui/form";
import { DataTable, PageHeader } from "@/components/ui/page";
import { hasRole, requireContext } from "@/lib/auth/session";
import { expiryBucket, todayIso } from "@/lib/domain/expiry";
import { loadProducts, listCategories } from "@/lib/data/catalog";
import { matchProduct } from "@/lib/domain/matching";
import { oneOf, pageNumber } from "@/lib/search";
import { formatDate, formatMoney, formatNumber } from "@/lib/utils";

export const metadata = { title: "Inventory" };
const PAGE = 50;
const SORTS = ["name", "qty_asc", "qty_desc", "updated"] as const;
const STATUSES = ["all", "low_stock", "out_of_stock", "ok", "archived"] as const;

export default async function InventoryPage({ searchParams }: PageProps<"/inventory">) {
  const ctx = await requireContext();
  const sp = await searchParams;
  const q = (typeof sp.q === "string" ? sp.q : "").trim().slice(0, 80);
  const status = oneOf(sp.status, STATUSES, "all");
  const sort = oneOf(sp.sort, SORTS, "name");
  const page = pageNumber(sp.page);
  const category = typeof sp.category === "string" ? sp.category.slice(0, 80) : "";
  const manager = hasRole(ctx.role, "manager");

  const [all, categories] = await Promise.all([loadProducts(ctx.business.id, status === "archived"), listCategories(ctx.business.id)]);
  let filtered = all.filter((p) => (status === "all" || status === "archived" || p.status === status) && (!category || p.categoryName === category));
  if (q) {
    const lower = q.toLowerCase();
    const direct = new Set(filtered.filter((p) => p.nameLower.includes(lower) || p.skuLower === lower || p.barcode === q || (p.brand ?? "").toLowerCase().includes(lower)).map((p) => p.id));
    for (const c of matchProduct(q, filtered, 50).candidates) if (c.score >= 0.6) direct.add(c.productId);
    filtered = filtered.filter((p) => direct.has(p.id));
  }
  filtered.sort((a, b) =>
    sort === "qty_asc" ? a.quantity - b.quantity : sort === "qty_desc" ? b.quantity - a.quantity : sort === "updated" ? b.updatedAt.localeCompare(a.updatedAt) : a.nameLower.localeCompare(b.nameLower),
  );
  const total = filtered.length;
  const rows = filtered.slice((page - 1) * PAGE, page * PAGE);
  const error = null;
  const today = todayIso(new Date(), ctx.business.timezone);
  const params = (patch: Record<string, string | number>) => {
    const u = new URLSearchParams();
    const merged = { q, status, sort, category, page, ...patch };
    for (const [k, v] of Object.entries(merged)) if (v && !(k === "page" && v === 1) && !(k === "status" && v === "all") && !(k === "sort" && v === "name")) u.set(k, String(v));
    return `/inventory${u.size ? `?${u}` : ""}`;
  };

  return (
    <>
      <PageHeader
        title="Inventory"
        description={`${formatNumber(total)} ${status === "archived" ? "archived " : ""}products`}
        actions={
          <>
            <BarcodeScanButton />
            <Button asChild variant="outline"><a href="/api/export/products" download><Download /> Export</a></Button>
            {manager && <Button asChild variant="outline"><Link href="/inventory/import"><FileUp /> Import</Link></Button>}
            {manager && <Button asChild><Link href="/inventory/new"><Plus /> Add product</Link></Button>}
          </>
        }
      />

      <form className="mb-4 grid gap-2 sm:grid-cols-[1fr_auto_auto_auto_auto]" role="search">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
          <Input name="q" defaultValue={q} placeholder="Search name, SKU, brand or barcode" className="pl-9" aria-label="Search products" />
        </div>
        <Select name="status" defaultValue={status} aria-label="Stock status" className="sm:w-40">
          <option value="all">All stock</option>
          <option value="low_stock">Low stock</option>
          <option value="out_of_stock">Out of stock</option>
          <option value="ok">In stock</option>
          <option value="archived">Archived</option>
        </Select>
        <Select name="category" defaultValue={category} aria-label="Category" className="sm:w-44">
          <option value="">All categories</option>
          {categories.map((c) => <option key={c.id}>{c.name}</option>)}
        </Select>
        <Select name="sort" defaultValue={sort} aria-label="Sort" className="sm:w-44">
          <option value="name">Name A–Z</option>
          <option value="qty_asc">Lowest stock first</option>
          <option value="qty_desc">Highest stock first</option>
          <option value="updated">Recently updated</option>
        </Select>
        <Button type="submit" variant="secondary">Apply</Button>
      </form>

      {error ? (
        <Alert tone="critical">Couldn&apos;t load products. Please refresh.</Alert>
      ) : rows.length === 0 ? (
        <Card>
          <EmptyState
            icon={Package}
            title={q || status !== "all" || category ? "No products match" : "No products yet"}
            description={q || status !== "all" || category ? "Try a different search or filter." : "Add products or import a CSV to start tracking stock."}
            action={manager && !q ? <Button asChild><Link href="/inventory/new"><Plus /> Add product</Link></Button> : undefined}
          />
        </Card>
      ) : (
        <>
          <ul className="space-y-2 md:hidden">
            {rows.map((p) => (
              <li key={p.id}>
                <Link href={`/inventory/${p.id}`} className="flex items-center justify-between gap-3 rounded-xl border border-border bg-surface p-3.5 shadow-card">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{p.name}</p>
                    <p className="truncate text-xs text-muted">{[p.sku, p.categoryName, p.storageLocation].filter(Boolean).join(" · ") || "—"}</p>
                    <div className="mt-1.5"><StockBadge status={p.status} /></div>
                  </div>
                  <div className="text-right">
                    <p className="tabular text-lg font-semibold">{formatNumber(p.quantity)}</p>
                    <p className="text-xs text-muted">{p.unit}</p>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
          <Card className="hidden md:block">
            <DataTable>
              <thead>
                <tr>
                  <th>Product</th><th>Category</th><th className="text-right">On hand</th><th className="text-right">Reorder at</th><th>Status</th><th>Next expiry</th>
                  {manager && <th className="text-right">Value</th>}
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => {
                  const bucket = expiryBucket(p.nextExpiry, today);
                  return (
                    <tr key={p.id}>
                      <td>
                        <Link href={`/inventory/${p.id}`} className="font-medium hover:underline">{p.name}</Link>
                        <p className="text-xs text-muted">{[p.sku, p.brand].filter(Boolean).join(" · ")}</p>
                      </td>
                      <td className="text-muted">{p.categoryName ?? "—"}</td>
                      <td className="tabular text-right font-semibold">{formatNumber(p.quantity)} <span className="font-normal text-muted">{p.unit}</span></td>
                      <td className="tabular text-right text-muted">{formatNumber(p.reorderThreshold)}</td>
                      <td><StockBadge status={p.status} /></td>
                      <td className={bucket === "expired" ? "font-medium text-critical" : bucket === "7" ? "font-medium text-warning" : "text-muted"}>{formatDate(p.nextExpiry)}</td>
                      {manager && <td className="tabular text-right">{formatMoney(p.quantity * p.costPrice, ctx.business.currency)}</td>}
                    </tr>
                  );
                })}
              </tbody>
            </DataTable>
          </Card>
          {total > PAGE && (
            <nav className="mt-4 flex items-center justify-between text-sm" aria-label="Pagination">
              <span className="text-muted">Page {page} of {Math.ceil(total / PAGE)}</span>
              <div className="flex gap-2">
                {page > 1 && <Button asChild variant="outline" size="sm"><Link href={params({ page: page - 1 })}>Previous</Link></Button>}
                {page * PAGE < total && <Button asChild variant="outline" size="sm"><Link href={params({ page: page + 1 })}>Next</Link></Button>}
              </div>
            </nav>
          )}
        </>
      )}
    </>
  );
}
