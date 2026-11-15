import Link from "next/link";
import { notFound } from "next/navigation";
import { History, Pencil } from "lucide-react";
import { DeleteVariantButton, EditBatchButton, ProductDangerZone, VariantForm } from "@/components/inventory/product-sections";
import { StockAdjust } from "@/components/inventory/stock-adjust";
import { StockBadge } from "@/components/inventory/stock-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { DataTable, PageHeader } from "@/components/ui/page";
import { hasRole, requireContext } from "@/lib/auth/session";
import { daysUntil, expiryBucket, todayIso } from "@/lib/domain/expiry";
import { stockStatus, suggestReorderQuantity } from "@/lib/domain/reorder";
import { MOVEMENT_LABELS } from "@/lib/domain/types";
import { formatDate, formatDateTime, formatMoney, formatNumber } from "@/lib/utils";
import { listLocations } from "@/lib/data/business";
import { getProduct, listBatches } from "@/lib/data/catalog";
import { getSupplier } from "@/lib/data/purchasing";
import { biz } from "@/lib/data/refs";

export const metadata = { title: "Product" };

export default async function ProductPage({ params }: PageProps<"/inventory/[id]">) {
  const { id } = await params;
  const ctx = await requireContext();
  const manager = hasRole(ctx.role, "manager");
  const [p, batches, movements, locations] = await Promise.all([
    getProduct(ctx.business.id, id),
    listBatches(ctx.business.id, id),
    biz(ctx.business.id).movements.where("productId", "==", id).orderBy("createdAt", "desc").limit(25).get().then((s) => s.docs.map((d) => ({ ...d.data(), id: d.id }))),
    listLocations(ctx.business.id),
  ]);
  if (!p) notFound();
  const supplierName = p.preferredSupplierId ? (await getSupplier(ctx.business.id, p.preferredSupplierId))?.name ?? null : null;

  const qty = p.quantity;
  const status = stockStatus(qty, p.reorderThreshold);
  const today = todayIso(new Date(), ctx.business.timezone);
  const suggested = suggestReorderQuantity({ currentQuantity: qty, reorderThreshold: p.reorderThreshold, reorderQuantity: p.reorderQuantity });
  const batchTotal = batches.reduce((s, b) => s + b.quantity, 0);
  const variants = p.variants;

  return (
    <>
      <PageHeader
        title={p.name}
        back={{ href: "/inventory", label: "Inventory" }}
        description={[p.sku && `SKU ${p.sku}`, p.brand, p.categoryName, p.storageLocation].filter(Boolean).join(" · ") || undefined}
        actions={
          <>
            <Button asChild variant="outline"><Link href={`/movements?product=${p.id}`}><History /> Full history</Link></Button>
            {manager && <Button asChild variant="outline"><Link href={`/inventory/${p.id}/edit`}><Pencil /> Edit</Link></Button>}
          </>
        }
      />
      {p.archivedAt && <div className="mb-4"><Badge tone="neutral">Archived {formatDate(p.archivedAt)}</Badge></div>}

      <div className="grid gap-6 lg:grid-cols-[1fr_1.2fr]">
        <div className="space-y-6">
          <Card>
            <CardBody className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-muted">On hand</p>
                <p className="tabular mt-1 text-3xl font-semibold">{formatNumber(qty)}</p>
                <p className="text-sm text-muted">{p.unit}</p>
              </div>
              <div className="space-y-2 text-sm">
                <StockBadge status={status} />
                <p className="text-muted">Reorder below <span className="tabular font-medium text-foreground">{formatNumber(p.reorderThreshold)}</span></p>
                {suggested > 0 && <p className="text-muted">Suggested order <span className="tabular font-medium text-foreground">{formatNumber(suggested)}</span></p>}
                <p className="text-muted">Supplier: <span className="text-foreground">{supplierName ?? "—"}</span></p>
              </div>
              {manager && (
                <div className="col-span-2 grid grid-cols-3 gap-3 border-t border-border pt-4 text-sm">
                  <div><p className="text-xs text-muted">Avg cost</p><p className="tabular font-medium">{formatMoney(p.costPrice, ctx.business.currency)}</p></div>
                  <div><p className="text-xs text-muted">Price</p><p className="tabular font-medium">{formatMoney(p.sellingPrice, ctx.business.currency)}</p></div>
                  <div><p className="text-xs text-muted">Stock value</p><p className="tabular font-medium">{formatMoney(qty * p.costPrice, ctx.business.currency)}</p></div>
                </div>
              )}
              <p className="col-span-2 text-xs text-muted">Last counted {p.lastCountedAt ? formatDateTime(p.lastCountedAt, ctx.business.timezone) : "never"}</p>
            </CardBody>
          </Card>

          {!p.archivedAt && (
            <StockAdjust
              productId={p.id}
              productName={p.name}
              unit={p.unit}
              current={qty}
              role={ctx.role}
              businessId={ctx.business.id}
              locations={locations.map((l) => ({ id: l.id, name: l.name }))}
              batches={batches.map((b) => ({ id: b.id, quantity: b.quantity, label: [b.batchNumber ?? "No batch no.", b.expiryDate ? `exp ${formatDate(b.expiryDate)}` : null].filter(Boolean).join(" · ") }))}
            />
          )}

          <Card>
            <CardHeader title="Packagings" description={`How package units convert to ${p.unit}. Used to understand “4 cases arrived”.`} />
            <CardBody className="space-y-4">
              {variants.length === 0 ? (
                <p className="text-sm text-muted">None yet. Without a packaging, StockPilot won&apos;t convert other units for this product.</p>
              ) : (
                <ul className="divide-y divide-border rounded-lg border border-border">
                  {variants.map((v) => (
                    <li key={v.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                      <span><span className="font-medium">{v.name}</span> <span className="text-muted">· 1 {v.unit} = {formatNumber(v.conversionFactor)} {p.unit}</span></span>
                      {manager && <DeleteVariantButton id={v.id} productId={p.id} />}
                    </li>
                  ))}
                </ul>
              )}
              {manager && <VariantForm productId={p.id} baseUnit={p.unit} />}
            </CardBody>
          </Card>

          {manager && (
            <Card>
              <CardHeader title="Manage" />
              <CardBody><ProductDangerZone productId={p.id} archived={!!p.archivedAt} isOwner={ctx.role === "owner"} /></CardBody>
            </Card>
          )}
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader title="Batches" description={batchTotal < qty ? `${formatNumber(qty - batchTotal)} ${p.unit} have no batch recorded.` : "Oldest expiry is used first."} />
            {batches.length === 0 ? (
              <CardBody><p className="text-sm text-muted">No batches. Record a batch and expiry date when receiving stock.</p></CardBody>
            ) : (
              <DataTable>
                <thead><tr><th>Batch</th><th>Expiry</th><th className="text-right">Qty</th><th>Received</th>{manager && <th />}</tr></thead>
                <tbody>
                  {batches.map((b) => {
                    const bucket = expiryBucket(b.expiryDate, today);
                    return (
                      <tr key={b.id}>
                        <td className="font-medium">{b.batchNumber ?? "—"}</td>
                        <td>
                          {b.expiryDate ? (
                            <span className="flex items-center gap-2">
                              {formatDate(b.expiryDate)}
                              {bucket === "expired" && <Badge tone="critical">Expired</Badge>}
                              {(bucket === "7" || bucket === "15") && <Badge tone="warning">{daysUntil(b.expiryDate, today)}d left</Badge>}
                            </span>
                          ) : "—"}
                        </td>
                        <td className="tabular text-right">{formatNumber(b.quantity)}</td>
                        <td className="text-muted">{formatDate(b.receivedAt)}</td>
                        {manager && <td className="text-right"><EditBatchButton productId={p.id} batch={{ id: b.id, batchNumber: b.batchNumber, expiryDate: b.expiryDate }} /></td>}
                      </tr>
                    );
                  })}
                </tbody>
              </DataTable>
            )}
          </Card>

          <Card>
            <CardHeader title="Recent movements" action={<Link href={`/movements?product=${p.id}`} className="text-sm font-medium text-primary hover:underline">All</Link>} />
            {movements.length === 0 ? (
              <CardBody><p className="text-sm text-muted">No stock changes yet.</p></CardBody>
            ) : (
              <ul className="divide-y divide-border">
                {movements.map((m) => (
                  <li key={m.id} className="flex items-start gap-3 px-5 py-3 text-sm">
                    <Badge tone={m.quantityChange > 0 ? "success" : m.quantityChange < 0 ? "warning" : "neutral"}>{MOVEMENT_LABELS[m.type]}</Badge>
                    <div className="min-w-0 flex-1">
                      <p className="tabular">
                        <span className={m.quantityChange > 0 ? "font-semibold text-success" : m.quantityChange < 0 ? "font-semibold text-critical" : "font-semibold"}>
                          {m.quantityChange > 0 ? "+" : ""}{formatNumber(m.quantityChange)}
                        </span>
                        <span className="text-muted"> → {formatNumber(m.quantityAfter)}</span>
                        {m.inputUnit && <span className="text-muted"> (said {formatNumber(Number(m.inputQuantity))} {m.inputUnit})</span>}
                      </p>
                      <p className="truncate text-xs text-muted">
                        {m.actorName ?? (m.source === "pos" ? "POS" : "System")} · {m.source}{m.aiConfidence ? ` · AI ${Math.round(m.aiConfidence * 100)}%` : ""}{m.reason ? ` · ${m.reason}` : ""}
                      </p>
                    </div>
                    <time className="shrink-0 text-xs text-muted" dateTime={m.createdAt}>{formatDateTime(m.createdAt, ctx.business.timezone)}</time>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
