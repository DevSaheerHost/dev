"use client";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatNumber } from "@/lib/utils";

export interface TrendPoint {
  day: string;
  inbound: number;
  outbound: number;
  units: number;
}

const axis = { stroke: "var(--muted)", fontSize: 11, tickLine: false, axisLine: false } as const;
const shortDay = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

function TooltipBox({ active, label, rows }: { active?: boolean; label?: string; rows: { name: string; value: number; color: string }[] }) {
  if (!active || !label) return null;
  return (
    <div className="rounded-lg border border-border bg-surface px-3 py-2 text-xs shadow-pop">
      <p className="mb-1 font-medium">{shortDay(label)}</p>
      {rows.map((r) => (
        <p key={r.name} className="flex items-center gap-2 text-muted">
          <span className="size-2 rounded-full" style={{ background: r.color }} aria-hidden />
          {r.name}: <span className="tabular font-medium text-foreground">{formatNumber(r.value)}</span>
        </p>
      ))}
    </div>
  );
}

/** Single series: total units on hand at the end of each day. Title names it, so no legend. */
export function UnitsTrendChart({ data }: { data: TrendPoint[] }) {
  return (
    <div className="h-56" role="img" aria-label="Units on hand over the last 30 days">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
          <defs>
            <linearGradient id="unitsFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--series-1)" stopOpacity={0.22} />
              <stop offset="100%" stopColor="var(--series-1)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke="var(--grid)" />
          <XAxis dataKey="day" tickFormatter={shortDay} minTickGap={28} {...axis} />
          <YAxis width={48} tickFormatter={(v) => formatNumber(v, 0)} {...axis} />
          <Tooltip
            cursor={{ stroke: "var(--border-strong)", strokeWidth: 1 }}
            content={({ active, label, payload }) => (
              <TooltipBox active={active} label={label as string} rows={(payload ?? []).map((p) => ({ name: "Units", value: Number(p.value), color: "var(--series-1)" }))} />
            )}
          />
          <Area type="monotone" dataKey="units" stroke="var(--series-1)" strokeWidth={2} fill="url(#unitsFill)" activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--surface)" }} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Two series: units in vs out per day. Legend always present. */
export function StockFlowChart({ data }: { data: TrendPoint[] }) {
  return (
    <div>
      <div className="mb-2 flex items-center gap-4 text-xs text-muted" aria-hidden>
        <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm" style={{ background: "var(--series-1)" }} /> Stock in</span>
        <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm" style={{ background: "var(--series-2)" }} /> Stock out</span>
      </div>
      <div className="h-52" role="img" aria-label="Units added and removed per day over the last 30 days">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 4, right: 8, left: -12, bottom: 0 }} barGap={2} barCategoryGap="25%">
            <CartesianGrid vertical={false} stroke="var(--grid)" />
            <XAxis dataKey="day" tickFormatter={shortDay} minTickGap={28} {...axis} />
            <YAxis width={48} tickFormatter={(v) => formatNumber(v, 0)} {...axis} />
            <Tooltip
              cursor={{ fill: "var(--surface-muted)" }}
              content={({ active, label, payload }) => (
                <TooltipBox
                  active={active}
                  label={label as string}
                  rows={(payload ?? []).map((p) => ({ name: p.dataKey === "inbound" ? "Stock in" : "Stock out", value: Number(p.value), color: p.dataKey === "inbound" ? "var(--series-1)" : "var(--series-2)" }))}
                />
              )}
            />
            <Bar dataKey="inbound" name="Stock in" fill="var(--series-1)" radius={[4, 4, 0, 0]} maxBarSize={14} />
            <Bar dataKey="outbound" name="Stock out" fill="var(--series-2)" radius={[4, 4, 0, 0]} maxBarSize={14} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

/** Accessible table equivalent of the trend charts. */
export function TrendTable({ data }: { data: TrendPoint[] }) {
  return (
    <details className="mt-3 text-sm">
      <summary className="cursor-pointer text-xs font-medium text-muted hover:text-foreground">View as table</summary>
      <div className="mt-2 max-h-64 overflow-y-auto rounded-lg border border-border">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-surface-muted text-muted">
            <tr><th className="px-3 py-2 text-left font-medium">Day</th><th className="px-3 py-2 text-right font-medium">In</th><th className="px-3 py-2 text-right font-medium">Out</th><th className="px-3 py-2 text-right font-medium">Units on hand</th></tr>
          </thead>
          <tbody className="tabular">
            {[...data].reverse().map((d) => (
              <tr key={d.day} className="border-t border-border">
                <td className="px-3 py-1.5">{shortDay(d.day)}</td>
                <td className="px-3 py-1.5 text-right">{formatNumber(d.inbound)}</td>
                <td className="px-3 py-1.5 text-right">{formatNumber(d.outbound)}</td>
                <td className="px-3 py-1.5 text-right">{formatNumber(d.units)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
