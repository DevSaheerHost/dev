import Link from "next/link";
import {
  AlertTriangle, Boxes, CalendarClock, CalendarX2, Camera, ClipboardList, DollarSign, FileUp, Mic, Package, PackageX, Sparkles, TrendingDown,
} from "lucide-react";
import { StockFlowChart, TrendTable, UnitsTrendChart, type TrendPoint } from "@/components/charts/dashboard-charts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Alert, Confidence, EmptyState } from "@/components/ui/feedback";
import { PageHeader, StatCard } from "@/components/ui/page";
import { hasRole, requireContext } from "@/lib/auth/session";
import { MOVEMENT_LABELS, type MovementType } from "@/lib/domain/types";
import { formatMoney, formatNumber, relativeTime } from "@/lib/utils";

export const metadata = { title: "Dashboard" };

interface Summary {
  total_products: number;
  total_units: number;
  inventory_value: number | null;
  low_stock: number;
  out_of_stock: number;
  expiring_soon: number;
  expired: number;
  damaged_units_30d: number;
  damaged_value_30d: number | null;
  pending_purchase_orders: number;
  pending_reviews: number;
  trend: TrendPoint[];
  expiry_buckets: { expired: number; within_7: number; within_15: number; within_30: number };
  top_selling: { id: string; name: string; unit: string; units: number }[];
  recent_movements: { id: string; created_at: string; movement_type: MovementType; source: string; quantity_change: number; quantity_after: number; product_name: string; unit: string; actor_name: string | null; ai_confidence: number | null }[];
  recent_ai: { id: string; created_at: string; source_type: "voice" | "photo"; is_valid: boolean; overall_confidence: number | null; actions: number; applied: number }[];
}

export default async function DashboardPage({ searchParams }: PageProps<"/dashboard">) {
  const ctx = await requireContext();
  const sp = await searchParams;
  const { data, error } = await ctx.supabase.rpc("dashboard_summary", { p_business_id: ctx.business.id });
  const s = data as Summary | null;
  const manager = hasRole(ctx.role, "manager");
  const greetingName = ctx.fullName?.split(" ")[0];

  return (
    <>
      <PageHeader
        title={greetingName ? `Hello, ${greetingName}` : "Dashboard"}
        description={`${ctx.business.name} · live inventory overview`}
        actions={
          <>
            <Button asChild variant="outline"><Link href="/photo"><Camera /> Photo audit</Link></Button>
            <Button asChild><Link href="/voice"><Mic /> Start voice audit</Link></Button>
          </>
        }
      />
      {sp.denied && <Alert tone="warning" className="mb-4">That page needs a manager or owner role.</Alert>}
      {error || !s ? (
        <Alert tone="critical" title="Couldn't load the dashboard">Please refresh. If it keeps happening, check the database connection.</Alert>
      ) : s.total_products === 0 ? (
        <Card>
          <EmptyState
            icon={Package}
            title="Let's add your products"
            description="StockPilot matches what you say and photograph to your catalog. Add products one by one or import a spreadsheet to get started."
            action={
              manager ? (
                <div className="flex flex-wrap justify-center gap-2">
                  <Button asChild><Link href="/inventory/new"><Package /> Add a product</Link></Button>
                  <Button asChild variant="outline"><Link href="/inventory/import"><FileUp /> Import CSV</Link></Button>
                </div>
              ) : (
                <p className="text-sm text-muted">Ask a manager to add the catalog first.</p>
              )
            }
          />
        </Card>
      ) : (
        <div className="space-y-6">
          {s.pending_reviews > 0 && (
            <Link href="/review" className="flex items-center justify-between gap-3 rounded-xl border border-primary/20 bg-primary-soft px-4 py-3 text-sm text-primary-soft-foreground">
              <span className="flex items-center gap-2 font-medium"><Sparkles className="size-4" /> {s.pending_reviews} AI {s.pending_reviews === 1 ? "suggestion is" : "suggestions are"} waiting for review</span>
              <span className="font-semibold">Review →</span>
            </Link>
          )}

          <section aria-label="Key figures" className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
            <StatCard label="Products" value={formatNumber(s.total_products)} icon={Package} tone="primary" href="/inventory" />
            <StatCard label="Units in stock" value={formatNumber(s.total_units, 0)} icon={Boxes} />
            {manager && <StatCard label="Inventory value" value={formatMoney(s.inventory_value, ctx.business.currency)} hint="At average cost" icon={DollarSign} tone="success" />}
            <StatCard label="Low stock" value={s.low_stock} icon={TrendingDown} tone={s.low_stock ? "warning" : "neutral"} href="/inventory?status=low_stock" />
            <StatCard label="Out of stock" value={s.out_of_stock} icon={PackageX} tone={s.out_of_stock ? "critical" : "neutral"} href="/inventory?status=out_of_stock" />
            <StatCard label="Expiring soon" value={s.expiring_soon} hint={`Next ${ctx.business.expiryWarningDays} days`} icon={CalendarClock} tone={s.expiring_soon ? "warning" : "neutral"} href="/expiring" />
            <StatCard label="Expired batches" value={s.expired} icon={CalendarX2} tone={s.expired ? "critical" : "neutral"} href="/expiring?bucket=expired" />
            <StatCard label="Damaged (30 days)" value={formatNumber(s.damaged_units_30d)} hint={manager && s.damaged_value_30d ? `${formatMoney(s.damaged_value_30d, ctx.business.currency)} lost` : "units"} icon={AlertTriangle} href="/movements?type=damage" />
            {manager && <StatCard label="Open purchase orders" value={s.pending_purchase_orders} hint="Draft or approved" icon={ClipboardList} href="/purchase-orders" />}
            <StatCard label="Awaiting review" value={s.pending_reviews} icon={Sparkles} tone={s.pending_reviews ? "primary" : "neutral"} href="/review" />
          </section>

          <div className="grid gap-6 xl:grid-cols-2">
            <Card>
              <CardHeader title="Units on hand" description="End of day, last 30 days" />
              <CardBody>
                <UnitsTrendChart data={s.trend} />
                <TrendTable data={s.trend} />
              </CardBody>
            </Card>
            <Card>
              <CardHeader title="Stock movement" description="Units added vs removed per day" />
              <CardBody>
                <StockFlowChart data={s.trend} />
              </CardBody>
            </Card>
          </div>

          <div className="grid gap-6 lg:grid-cols-3">
            <Card>
              <CardHeader title="Expiration overview" action={<Link href="/expiring" className="text-sm font-medium text-primary hover:underline">Open</Link>} />
              <CardBody className="space-y-3">
                {([
                  ["Expired", s.expiry_buckets.expired, "critical", "expired"],
                  ["Within 7 days", s.expiry_buckets.within_7, "warning", "7"],
                  ["8–15 days", s.expiry_buckets.within_15, "warning", "15"],
                  ["16–30 days", s.expiry_buckets.within_30, "neutral", "30"],
                ] as const).map(([label, count, tone, bucket]) => (
                  <Link key={label} href={`/expiring?bucket=${bucket}`} className="flex items-center justify-between rounded-lg px-1 py-1 hover:bg-surface-muted">
                    <span className="flex items-center gap-2 text-sm">
                      <Badge tone={count ? tone : "neutral"}>{tone === "critical" ? <CalendarX2 /> : <CalendarClock />}{label}</Badge>
                    </span>
                    <span className="tabular text-sm font-semibold">{count} {count === 1 ? "batch" : "batches"}</span>
                  </Link>
                ))}
              </CardBody>
            </Card>

            <Card>
              <CardHeader title="Top sellers" description="Last 30 days" />
              <CardBody>
                {s.top_selling.length === 0 ? (
                  <p className="text-sm text-muted">No sales recorded yet. Connect your POS or record sales to see top sellers.</p>
                ) : (
                  <ol className="space-y-2.5">
                    {s.top_selling.map((t, i) => (
                      <li key={t.id} className="flex items-center gap-3 text-sm">
                        <span className="tabular w-4 text-muted">{i + 1}</span>
                        <Link href={`/inventory/${t.id}`} className="min-w-0 flex-1 truncate hover:underline">{t.name}</Link>
                        <span className="tabular font-medium">{formatNumber(t.units)}</span>
                      </li>
                    ))}
                  </ol>
                )}
              </CardBody>
            </Card>

            <Card>
              <CardHeader title="Recent AI activity" action={<Link href="/review" className="text-sm font-medium text-primary hover:underline">Review</Link>} />
              <CardBody>
                {s.recent_ai.length === 0 ? (
                  <p className="text-sm text-muted">No voice or photo audits yet. Try saying “we have six bottles of shampoo left”.</p>
                ) : (
                  <ul className="space-y-3">
                    {s.recent_ai.map((a) => (
                      <li key={a.id} className="flex items-center gap-3 text-sm">
                        <span className="flex size-8 items-center justify-center rounded-lg bg-surface-muted text-muted">{a.source_type === "voice" ? <Mic className="size-4" /> : <Camera className="size-4" />}</span>
                        <div className="min-w-0 flex-1">
                          <p className="font-medium">{a.is_valid ? `${a.applied}/${a.actions} changes applied` : "Could not be interpreted"}</p>
                          <p className="text-xs text-muted">{relativeTime(a.created_at)}</p>
                        </div>
                        <Confidence value={a.overall_confidence} />
                      </li>
                    ))}
                  </ul>
                )}
              </CardBody>
            </Card>
          </div>

          <Card>
            <CardHeader title="Recent stock adjustments" action={<Link href="/movements" className="text-sm font-medium text-primary hover:underline">All movements</Link>} />
            <ul className="divide-y divide-border">
              {s.recent_movements.length === 0 && <li className="px-5 py-6 text-sm text-muted">No stock movements yet.</li>}
              {s.recent_movements.map((m) => (
                <li key={m.id} className="flex items-center gap-3 px-5 py-3 text-sm">
                  <Badge tone={m.quantity_change > 0 ? "success" : m.quantity_change < 0 ? "warning" : "neutral"}>{MOVEMENT_LABELS[m.movement_type]}</Badge>
                  <span className="min-w-0 flex-1 truncate font-medium">{m.product_name}</span>
                  <span className={`tabular font-semibold ${m.quantity_change > 0 ? "text-success" : m.quantity_change < 0 ? "text-critical" : ""}`}>
                    {m.quantity_change > 0 ? "+" : ""}{formatNumber(m.quantity_change)}
                  </span>
                  <span className="hidden w-40 truncate text-right text-xs text-muted sm:block">
                    {m.actor_name ?? (m.source === "pos" ? "POS" : "System")} · {relativeTime(m.created_at)}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      )}
    </>
  );
}
