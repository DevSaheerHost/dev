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
import { MOVEMENT_LABELS, type MovementType } from "@/lib/domain/types";
import { formatDate, formatDateTime, formatMoney, formatNumber } from "@/lib/utils";

export const metadata = { title: "Product" };

export default async function ProductPage({ params }: PageProps<"/inventory/[id]">) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const ctx = await requireContext();
  const manager = hasRole(ctx.role, "manager");

  const [{ data: p }, { data: batches }, { data: variants }, { data: movements }, { data: locations }] = await Promise.all([
    ctx.supabase.from("products").select("*, product_categories(name), suppliers(name)").eq("id", id).eq("business_id", ctx.business.id).maybeSingle(),
    ctx.supabase.from("inventory_batches").select("id, batch_number, expiry_date, quantity, received_at, unit_cost").eq("product_id", id).gt("quantity", 0).order("expiry_date", { ascending: true, nullsFirst: false }),
    ctx.supabase.from("product_variants").select("id, name, unit, conversion_factor, barcode").eq("product_id", id).order("conversion_factor"),
    ctx.supabase.from("inventory_movements").select("id, created_at, movement_type, source, quantity_change, quantity_after, reason, ai_confidence, actor_id, input_quantity, input_unit").eq("product_id", id).order("created_at", { ascending: false }).limit(25),
    ctx.supabase.from("business_locations").select("id, name").eq("business_id", ctx.business.id).order("name"),
  ]);
  if (!p) notFound();

  const actorIds = [...new Set((movements ?? []).map((m) => m.actor_id).filter(Boolean))] as string[];
  const { data: actors } = actorIds.length ? await ctx.supabase.from("profiles").select("id, full_name, email").in("id", actorIds) : { data: [] };
  const actorName = new Map((actors ?? []).map((a) => [a.id, a.full_name || a.email]));

  const qty = Number(p.current_quantity);
  const status = stockStatus(qty, Number(p.reorder_threshold));
  const today = todayIso(new Date(), ctx.business.timezone);
  const suggested = suggestReorderQuantity({ currentQuantity: qty, reorderThreshold: Number(p.reorder_threshold), reorderQuantity: p.reorder_quantity === null ? null : Number(p.reorder_quantity) });
  const batchTotal = (batches ?? []).reduce((s, b) => s + Number(b.quantity), 0);

  return (
    <>
      <PageHeader
        title={p.name}
        back={{ href: "/inventory", label: "Inventory" }}
        description={[p.sku && `SKU ${p.sku}`, p.brand, (p.product_categories as { name: string } | null)?.name, p.storage_location].filter(Boolean).join(" · ") || undefined}
        actions={
          <>
            <Button asChild variant="outline"><Link href={`/movements?product=${p.id}`}><History /> Full history</Link></Button>
            {manager && <Button asChild variant="outline"><Link href={`/inventory/${p.id}/edit`}><Pencil /> Edit</Link></Button>}
          </>
        }
      />
      {p.archived_at && <div className="mb-4"><Badge tone="neutral">Archived {formatDate(p.archived_at)}</Badge></div>}

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
                <p className="text-muted">Reorder below <span className="tabular font-medium text-foreground">{formatNumber(Number(p.reorder_threshold))}</span></p>
                {suggested > 0 && <p className="text-muted">Suggested order <span className="tabular font-medium text-foreground">{formatNumber(suggested)}</span></p>}
                <p className="text-muted">Supplier: <span className="text-foreground">{(p.suppliers as { name: string } | null)?.name ?? "—"}</span></p>
              </div>
              {manager && (
                <div className="col-span-2 grid grid-cols-3 gap-3 border-t border-border pt-4 text-sm">
                  <div><p className="text-xs text-muted">Avg cost</p><p className="tabular font-medium">{formatMoney(Number(p.cost_price), ctx.business.currency)}</p></div>
                  <div><p className="text-xs text-muted">Price</p><p className="tabular font-medium">{formatMoney(Number(p.selling_price), ctx.business.currency)}</p></div>
                  <div><p className="text-xs text-muted">Stock value</p><p className="tabular font-medium">{formatMoney(qty * Number(p.cost_price), ctx.business.currency)}</p></div>
                </div>
              )}
              <p className="col-span-2 text-xs text-muted">Last counted {p.last_counted_at ? formatDateTime(p.last_counted_at, ctx.business.timezone) : "never"}</p>
            </CardBody>
          </Card>

          {!p.archived_at && (
            <StockAdjust
              productId={p.id}
              productName={p.name}
              unit={p.unit}
              current={qty}
              role={ctx.role}
              businessId={ctx.business.id}
              locations={locations ?? []}
              batches={(batches ?? []).map((b) => ({ id: b.id, quantity: Number(b.quantity), label: [b.batch_number ?? "No batch no.", b.expiry_date ? `exp ${formatDate(b.expiry_date)}` : null].filter(Boolean).join(" · ") }))}
            />
          )}

          <Card>
            <CardHeader title="Packagings" description={`How package units convert to ${p.unit}. Used to understand “4 cases arrived”.`} />
            <CardBody className="space-y-4">
              {(variants ?? []).length === 0 ? (
                <p className="text-sm text-muted">None yet. Without a packaging, StockPilot won&apos;t convert other units for this product.</p>
              ) : (
                <ul className="divide-y divide-border rounded-lg border border-border">
                  {variants!.map((v) => (
                    <li key={v.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                      <span><span className="font-medium">{v.name}</span> <span className="text-muted">· 1 {v.unit} = {formatNumber(Number(v.conversion_factor))} {p.unit}</span></span>
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
              <CardBody><ProductDangerZone productId={p.id} archived={!!p.archived_at} isOwner={ctx.role === "owner"} /></CardBody>
            </Card>
          )}
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader title="Batches" description={batchTotal < qty ? `${formatNumber(qty - batchTotal)} ${p.unit} have no batch recorded.` : "Oldest expiry is used first."} />
            {(batches ?? []).length === 0 ? (
              <CardBody><p className="text-sm text-muted">No batches. Record a batch and expiry date when receiving stock.</p></CardBody>
            ) : (
              <DataTable>
                <thead><tr><th>Batch</th><th>Expiry</th><th className="text-right">Qty</th><th>Received</th>{manager && <th />}</tr></thead>
                <tbody>
                  {batches!.map((b) => {
                    const bucket = expiryBucket(b.expiry_date, today);
                    return (
                      <tr key={b.id}>
                        <td className="font-medium">{b.batch_number ?? "—"}</td>
                        <td>
                          {b.expiry_date ? (
                            <span className="flex items-center gap-2">
                              {formatDate(b.expiry_date)}
                              {bucket === "expired" && <Badge tone="critical">Expired</Badge>}
                              {(bucket === "7" || bucket === "15") && <Badge tone="warning">{daysUntil(b.expiry_date, today)}d left</Badge>}
                            </span>
                          ) : "—"}
                        </td>
                        <td className="tabular text-right">{formatNumber(Number(b.quantity))}</td>
                        <td className="text-muted">{formatDate(b.received_at)}</td>
                        {manager && <td className="text-right"><EditBatchButton productId={p.id} batch={{ id: b.id, batchNumber: b.batch_number, expiryDate: b.expiry_date }} /></td>}
                      </tr>
                    );
                  })}
                </tbody>
              </DataTable>
            )}
          </Card>

          <Card>
            <CardHeader title="Recent movements" action={<Link href={`/movements?product=${p.id}`} className="text-sm font-medium text-primary hover:underline">All</Link>} />
            {(movements ?? []).length === 0 ? (
              <CardBody><p className="text-sm text-muted">No stock changes yet.</p></CardBody>
            ) : (
              <ul className="divide-y divide-border">
                {movements!.map((m) => (
                  <li key={m.id} className="flex items-start gap-3 px-5 py-3 text-sm">
                    <Badge tone={Number(m.quantity_change) > 0 ? "success" : Number(m.quantity_change) < 0 ? "warning" : "neutral"}>{MOVEMENT_LABELS[m.movement_type as MovementType]}</Badge>
                    <div className="min-w-0 flex-1">
                      <p className="tabular">
                        <span className={Number(m.quantity_change) > 0 ? "font-semibold text-success" : Number(m.quantity_change) < 0 ? "font-semibold text-critical" : "font-semibold"}>
                          {Number(m.quantity_change) > 0 ? "+" : ""}{formatNumber(Number(m.quantity_change))}
                        </span>
                        <span className="text-muted"> → {formatNumber(Number(m.quantity_after))}</span>
                        {m.input_unit && <span className="text-muted"> (said {formatNumber(Number(m.input_quantity))} {m.input_unit})</span>}
                      </p>
                      <p className="truncate text-xs text-muted">
                        {(m.actor_id && actorName.get(m.actor_id)) || (m.source === "pos" ? "POS" : "System")} · {m.source}{m.ai_confidence ? ` · AI ${Math.round(Number(m.ai_confidence) * 100)}%` : ""}{m.reason ? ` · ${m.reason}` : ""}
                      </p>
                    </div>
                    <time className="shrink-0 text-xs text-muted" dateTime={m.created_at}>{formatDateTime(m.created_at, ctx.business.timezone)}</time>
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
