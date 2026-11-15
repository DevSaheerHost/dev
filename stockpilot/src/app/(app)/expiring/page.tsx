import Link from "next/link";
import { CalendarCheck } from "lucide-react";
import { WriteOffButton } from "@/components/inventory/write-off-button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Alert, EmptyState } from "@/components/ui/feedback";
import { DataTable, PageHeader } from "@/components/ui/page";
import { hasRole, requireContext } from "@/lib/auth/session";
import { daysUntil, EXPIRY_BUCKET_LABELS, expiryBucket, todayIso, type ExpiryBucket } from "@/lib/domain/expiry";
import { oneOf } from "@/lib/search";
import { cn, formatDate, formatMoney, formatNumber } from "@/lib/utils";

export const metadata = { title: "Expiring stock" };
const TABS = ["expired", "7", "15", "30", "all"] as const;

interface Row {
  id: string; product_id: string; product_name: string; unit: string; sku: string | null; batch_number: string | null; expiry_date: string;
  quantity: number; unit_cost: number; value_at_risk: number; storage_location: string | null;
}

export default async function ExpiringPage({ searchParams }: PageProps<"/expiring">) {
  const ctx = await requireContext();
  const tab = oneOf((await searchParams).bucket, TABS, "7");
  const today = todayIso(new Date(), ctx.business.timezone);
  const manager = hasRole(ctx.role, "manager");
  const horizon = new Date(Date.UTC(+today.slice(0, 4), +today.slice(5, 7) - 1, +today.slice(8, 10) + Math.max(30, ctx.business.expiryWarningDays))).toISOString().slice(0, 10);

  const { data, error } = await ctx.supabase
    .from("expiring_batches")
    .select("id, product_id, product_name, unit, sku, batch_number, expiry_date, quantity, unit_cost, value_at_risk, storage_location")
    .eq("business_id", ctx.business.id)
    .lte("expiry_date", horizon)
    .order("expiry_date")
    .limit(500);
  const all = (data ?? []) as Row[];
  const counts: Record<string, number> = { expired: 0, "7": 0, "15": 0, "30": 0 };
  for (const r of all) {
    const b = expiryBucket(r.expiry_date, today);
    if (b in counts) counts[b]++;
  }
  const inTab = (b: ExpiryBucket) => tab === "all" || b === tab;
  const rows = all.filter((r) => inTab(expiryBucket(r.expiry_date, today)));
  const atRisk = rows.reduce((s, r) => s + Number(r.value_at_risk), 0);

  return (
    <>
      <PageHeader title="Expiring stock" description="Sell or remove these first. Batches expiring earliest are deducted first (FEFO)." />
      <nav className="mb-4 flex gap-1 overflow-x-auto rounded-xl border border-border bg-surface p-1" aria-label="Expiry window">
        {TABS.map((t) => (
          <Link
            key={t}
            href={`/expiring?bucket=${t}`}
            aria-current={tab === t ? "page" : undefined}
            className={cn("flex shrink-0 items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium", tab === t ? "bg-primary-soft text-primary-soft-foreground" : "text-muted hover:bg-surface-muted")}
          >
            {t === "all" ? "Next 30+ days" : EXPIRY_BUCKET_LABELS[t]}
            {t !== "all" && <span className={cn("tabular rounded-full px-1.5 text-xs", t === "expired" && counts[t] ? "bg-critical text-white" : "bg-surface-muted")}>{counts[t]}</span>}
          </Link>
        ))}
      </nav>
      {error ? (
        <Alert tone="critical">Couldn&apos;t load batches.</Alert>
      ) : rows.length === 0 ? (
        <Card><EmptyState icon={CalendarCheck} title="Nothing here" description={tab === "expired" ? "No expired stock on record." : "No batches expire in this window."} /></Card>
      ) : (
        <>
          {manager && <p className="mb-3 text-sm text-muted">Value at risk in this view: <span className="font-semibold text-foreground">{formatMoney(atRisk, ctx.business.currency)}</span></p>}
          <Card>
            <DataTable>
              <thead><tr><th>Product</th><th>Batch</th><th>Expires</th><th className="text-right">Qty</th>{manager && <th className="text-right">Value</th>}<th /></tr></thead>
              <tbody>
                {rows.map((r) => {
                  const days = daysUntil(r.expiry_date, today);
                  const expired = days < 0;
                  return (
                    <tr key={r.id}>
                      <td>
                        <Link href={`/inventory/${r.product_id}`} className="font-medium hover:underline">{r.product_name}</Link>
                        <p className="text-xs text-muted">{[r.sku, r.storage_location].filter(Boolean).join(" · ")}</p>
                      </td>
                      <td>{r.batch_number ?? "—"}</td>
                      <td>
                        <span className="flex flex-wrap items-center gap-2">
                          {formatDate(r.expiry_date)}
                          <Badge tone={expired ? "critical" : days <= 7 ? "warning" : "neutral"}>{expired ? `${-days}d ago` : days === 0 ? "Today" : `${days}d left`}</Badge>
                        </span>
                      </td>
                      <td className="tabular text-right">{formatNumber(Number(r.quantity))} <span className="text-muted">{r.unit}</span></td>
                      {manager && <td className="tabular text-right">{formatMoney(Number(r.value_at_risk), ctx.business.currency)}</td>}
                      <td className="text-right">
                        {expired && (
                          <WriteOffButton productId={r.product_id} productName={r.product_name} batchId={r.id} quantity={Number(r.quantity)} unit={r.unit} unitCost={Number(r.unit_cost)} currency={ctx.business.currency} showCost={manager} />
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </DataTable>
          </Card>
        </>
      )}
    </>
  );
}
