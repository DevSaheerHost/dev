import Link from "next/link";
import { BarChart3, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Alert, EmptyState } from "@/components/ui/feedback";
import { Input } from "@/components/ui/form";
import { DataTable, PageHeader } from "@/components/ui/page";
import { requireRole } from "@/lib/auth/session";
import { todayIso } from "@/lib/domain/expiry";
import { REPORTS, type ReportKey } from "@/lib/reports";
import { oneOf } from "@/lib/search";
import { cn, formatDate, formatDateTime, formatMoney, formatNumber } from "@/lib/utils";

export const metadata = { title: "Reports" };
const KEYS = Object.keys(REPORTS) as ReportKey[];
const isDate = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);

export default async function ReportsPage({ searchParams }: PageProps<"/reports">) {
  const ctx = await requireRole("manager");
  const sp = await searchParams;
  const type = oneOf(sp.type, KEYS, "weekly_summary");
  const today = todayIso(new Date(), ctx.business.timezone);
  const monthAgo = new Date(Date.parse(`${today}T00:00:00Z`) - 29 * 86400_000).toISOString().slice(0, 10);
  const from = isDate(sp.from) ? sp.from : type === "monthly_valuation" ? `${today.slice(0, 4)}-01-01` : monthAgo;
  const to = isDate(sp.to) ? sp.to : today;
  const report = REPORTS[type];
  const { data, error } = await ctx.supabase.rpc("inventory_report", { p_business_id: ctx.business.id, p_report: type, p_from: from, p_to: to });
  const rows = (data ?? []) as Record<string, unknown>[];

  const fmt = (value: unknown, format: (typeof report.columns)[number]["format"]) => {
    if (value === null || value === undefined) return "—";
    switch (format) {
      case "money": return formatMoney(Number(value), ctx.business.currency);
      case "number": return formatNumber(Number(value));
      case "percent": return `${formatNumber(Number(value), 1)}%`;
      case "date": return formatDate(String(value));
      case "datetime": return formatDateTime(String(value), ctx.business.timezone);
      case "bool": return value ? "Yes" : "No";
      default: return String(value).replace(/_/g, " ");
    }
  };
  const numeric = (f: string) => ["money", "number", "percent"].includes(f);

  return (
    <>
      <PageHeader title="Reports" description="Built from the movement ledger and review history. Export any report as CSV." />
      <div className="grid gap-6 lg:grid-cols-[240px_1fr]">
        <nav aria-label="Reports" className="flex gap-1 overflow-x-auto lg:flex-col">
          {KEYS.map((k) => (
            <Link
              key={k}
              href={`/reports?type=${k}&from=${from}&to=${to}`}
              aria-current={k === type ? "page" : undefined}
              className={cn("shrink-0 rounded-lg px-3 py-2 text-sm font-medium", k === type ? "bg-primary-soft text-primary-soft-foreground" : "text-muted hover:bg-surface-muted hover:text-foreground")}
            >
              {REPORTS[k].title}
            </Link>
          ))}
        </nav>
        <div className="min-w-0 space-y-4">
          <form className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="type" value={type} />
            <label className="text-sm"><span className="mb-1 block text-xs text-muted">From</span><Input type="date" name="from" defaultValue={from} max={to} /></label>
            <label className="text-sm"><span className="mb-1 block text-xs text-muted">To</span><Input type="date" name="to" defaultValue={to} max={today} /></label>
            <Button type="submit" variant="secondary">Update</Button>
            <Button asChild variant="outline" className="ml-auto"><a href={`/api/export/report?type=${type}&from=${from}&to=${to}`} download><Download /> CSV</a></Button>
          </form>
          <Card>
            <CardHeader title={report.title} description={report.description} />
            {error ? (
              <div className="p-5"><Alert tone="critical">{error.message.startsWith("invalid_range") ? "Choose a range of at most two years." : "Couldn't run this report."}</Alert></div>
            ) : rows.length === 0 ? (
              <EmptyState icon={BarChart3} title="No data for this period" description="Try a wider date range." />
            ) : (
              <DataTable>
                <thead><tr>{report.columns.map((c) => <th key={c.key} className={numeric(c.format) ? "text-right" : undefined}>{c.label}</th>)}</tr></thead>
                <tbody>
                  {rows.slice(0, 500).map((r, i) => (
                    <tr key={i}>{report.columns.map((c) => <td key={c.key} className={cn(numeric(c.format) && "tabular text-right", c.format === "text" && "capitalize-first")}>{fmt(r[c.key], c.format)}</td>)}</tr>
                  ))}
                </tbody>
              </DataTable>
            )}
          </Card>
          {rows.length > 500 && <p className="text-xs text-muted">Showing the first 500 rows. Export CSV for all {rows.length}.</p>}
        </div>
      </div>
    </>
  );
}
