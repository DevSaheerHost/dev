import Link from "next/link";
import {
  AlertTriangle, Boxes, CalendarClock, CalendarX2, Camera, ClipboardList, DollarSign, FileUp, Mic, Package, PackageX, Sparkles, TrendingDown,
} from "lucide-react";
import { StockFlowChart, TrendTable, UnitsTrendChart } from "@/components/charts/dashboard-charts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Alert, Confidence, EmptyState } from "@/components/ui/feedback";
import { PageHeader, StatCard } from "@/components/ui/page";
import { hasRole, requireContext } from "@/lib/auth/session";
import { dashboardSummary } from "@/lib/data/reports";
import { MOVEMENT_LABELS } from "@/lib/domain/types";
import { formatMoney, formatNumber, relativeTime } from "@/lib/utils";

export const metadata = { title: "Dashboard" };

export default async function DashboardPage({ searchParams }: PageProps<"/dashboard">) {
  const ctx = await requireContext();
  const sp = await searchParams;
  const s = await dashboardSummary(ctx).catch((e) => {
    console.error("Dashboard failed", e);
    return null;
  });
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
      {!s ? (
        <Alert tone="critical" title="Couldn't load the dashboard">Please refresh. If it keeps happening, check the database connection.</Alert>
      ) : s.totalProducts === 0 ? (
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
          {s.pendingReviews > 0 && (
            <Link href="/review" className="flex items-center justify-between gap-3 rounded-xl border border-primary/20 bg-primary-soft px-4 py-3 text-sm text-primary-soft-foreground">
              <span className="flex items-center gap-2 font-medium"><Sparkles className="size-4" /> {s.pendingReviews} AI {s.pendingReviews === 1 ? "suggestion is" : "suggestions are"} waiting for review</span>
              <span className="font-semibold">Review →</span>
            </Link>
          )}

          <section aria-label="Key figures" className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
            <StatCard label="Products" value={formatNumber(s.totalProducts)} icon={Package} tone="primary" href="/inventory" />
            <StatCard label="Units in stock" value={formatNumber(s.totalUnits, 0)} icon={Boxes} />
            {manager && <StatCard label="Inventory value" value={formatMoney(s.inventoryValue, ctx.business.currency)} hint="At average cost" icon={DollarSign} tone="success" />}
            <StatCard label="Low stock" value={s.lowStock} icon={TrendingDown} tone={s.lowStock ? "warning" : "neutral"} href="/inventory?status=low_stock" />
            <StatCard label="Out of stock" value={s.outOfStock} icon={PackageX} tone={s.outOfStock ? "critical" : "neutral"} href="/inventory?status=out_of_stock" />
            <StatCard label="Expiring soon" value={s.expiringSoon} hint={`Next ${ctx.business.expiryWarningDays} days`} icon={CalendarClock} tone={s.expiringSoon ? "warning" : "neutral"} href="/expiring" />
            <StatCard label="Expired batches" value={s.expired} icon={CalendarX2} tone={s.expired ? "critical" : "neutral"} href="/expiring?bucket=expired" />
            <StatCard label="Damaged (30 days)" value={formatNumber(s.damagedUnits30d)} hint={manager && s.damagedValue30d ? `${formatMoney(s.damagedValue30d, ctx.business.currency)} lost` : "units"} icon={AlertTriangle} href="/movements?type=damage" />
            {manager && <StatCard label="Open purchase orders" value={s.pendingPurchaseOrders} hint="Draft or approved" icon={ClipboardList} href="/purchase-orders" />}
            <StatCard label="Awaiting review" value={s.pendingReviews} icon={Sparkles} tone={s.pendingReviews ? "primary" : "neutral"} href="/review" />
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
                  ["Expired", s.expiryBuckets.expired, "critical", "expired"],
                  ["Within 7 days", s.expiryBuckets.within7, "warning", "7"],
                  ["8–15 days", s.expiryBuckets.within15, "warning", "15"],
                  ["16–30 days", s.expiryBuckets.within30, "neutral", "30"],
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
                {s.topSelling.length === 0 ? (
                  <p className="text-sm text-muted">No sales recorded yet. Connect your POS or record sales to see top sellers.</p>
                ) : (
                  <ol className="space-y-2.5">
                    {s.topSelling.map((t, i) => (
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
                {s.recentAi.length === 0 ? (
                  <p className="text-sm text-muted">No voice or photo audits yet. Try saying “we have six bottles of shampoo left”.</p>
                ) : (
                  <ul className="space-y-3">
                    {s.recentAi.map((a) => (
                      <li key={a.id} className="flex items-center gap-3 text-sm">
                        <span className="flex size-8 items-center justify-center rounded-lg bg-surface-muted text-muted">{a.sourceType === "voice" ? <Mic className="size-4" /> : <Camera className="size-4" />}</span>
                        <div className="min-w-0 flex-1">
                          <p className="font-medium">{a.isValid ? `${a.applied}/${a.actions} changes applied` : "Could not be interpreted"}</p>
                          <p className="text-xs text-muted">{relativeTime(a.createdAt)}</p>
                        </div>
                        <Confidence value={a.overallConfidence} />
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
              {s.recentMovements.length === 0 && <li className="px-5 py-6 text-sm text-muted">No stock movements yet.</li>}
              {s.recentMovements.map((m) => (
                <li key={m.id} className="flex items-center gap-3 px-5 py-3 text-sm">
                  <Badge tone={m.quantityChange > 0 ? "success" : m.quantityChange < 0 ? "warning" : "neutral"}>{MOVEMENT_LABELS[m.type]}</Badge>
                  <span className="min-w-0 flex-1 truncate font-medium">{m.productName}</span>
                  <span className={`tabular font-semibold ${m.quantityChange > 0 ? "text-success" : m.quantityChange < 0 ? "text-critical" : ""}`}>
                    {m.quantityChange > 0 ? "+" : ""}{formatNumber(m.quantityChange)}
                  </span>
                  <span className="hidden w-40 truncate text-right text-xs text-muted sm:block">
                    {m.actorName ?? (m.source === "pos" ? "POS" : "System")} · {relativeTime(m.createdAt)}
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
