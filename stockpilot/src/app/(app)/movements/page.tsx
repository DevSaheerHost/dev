import Link from "next/link";
import { ArrowLeftRight, Download } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Alert, EmptyState } from "@/components/ui/feedback";
import { Input, Select } from "@/components/ui/form";
import { DataTable, PageHeader } from "@/components/ui/page";
import { hasRole, requireContext } from "@/lib/auth/session";
import { MOVEMENT_LABELS, MOVEMENT_SOURCES, MOVEMENT_TYPES, type MovementType } from "@/lib/domain/types";
import { pageNumber } from "@/lib/search";
import { formatDateTime, formatMoney, formatNumber } from "@/lib/utils";

export const metadata = { title: "Stock movements" };
const PAGE = 50;
const isDate = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);

export default async function MovementsPage({ searchParams }: PageProps<"/movements">) {
  const ctx = await requireContext();
  const sp = await searchParams;
  const manager = hasRole(ctx.role, "manager");
  const type = MOVEMENT_TYPES.includes(sp.type as MovementType) ? (sp.type as MovementType) : null;
  const source = (MOVEMENT_SOURCES as readonly string[]).includes(sp.source as string) ? (sp.source as string) : null;
  const product = typeof sp.product === "string" && /^[0-9a-f-]{36}$/.test(sp.product) ? sp.product : null;
  const from = isDate(sp.from) ? sp.from : null;
  const to = isDate(sp.to) ? sp.to : null;
  const page = pageNumber(sp.page);

  let query = ctx.supabase
    .from("inventory_movements")
    .select("id, created_at, movement_type, source, quantity_before, quantity_change, quantity_after, value_change, reason, ai_confidence, approval_status, actor_id, approved_by, input_quantity, input_unit, external_ref, products(id, name, unit)", { count: "exact" })
    .eq("business_id", ctx.business.id)
    .order("created_at", { ascending: false });
  if (type) query = query.eq("movement_type", type);
  if (source) query = query.eq("source", source);
  if (product) query = query.eq("product_id", product);
  if (from) query = query.gte("created_at", `${from}T00:00:00Z`);
  if (to) query = query.lte("created_at", `${to}T23:59:59.999Z`);
  const { data, count, error } = await query.range((page - 1) * PAGE, page * PAGE - 1);

  const people = [...new Set((data ?? []).flatMap((m) => [m.actor_id, m.approved_by]).filter(Boolean))] as string[];
  const { data: profiles } = people.length ? await ctx.supabase.from("profiles").select("id, full_name, email").in("id", people) : { data: [] };
  const name = new Map((profiles ?? []).map((p) => [p.id, p.full_name || p.email]));
  const qs = (p: number) => {
    const u = new URLSearchParams();
    for (const [k, v] of Object.entries({ type, source, product, from, to })) if (v) u.set(k, v);
    if (p > 1) u.set("page", String(p));
    return `/movements${u.size ? `?${u}` : ""}`;
  };

  return (
    <>
      <PageHeader
        title="Stock movements"
        description="The permanent audit log. Entries are never edited or deleted — mistakes are fixed with a correction."
        actions={manager && <Button asChild variant="outline"><a href={`/api/export/movements?from=${from ?? ""}&to=${to ?? ""}`} download><Download /> Export CSV</a></Button>}
      />
      <form className="mb-4 grid grid-cols-2 gap-2 md:grid-cols-[1fr_1fr_1fr_1fr_auto]">
        {product && <input type="hidden" name="product" value={product} />}
        <Select name="type" defaultValue={type ?? ""} aria-label="Type">
          <option value="">All types</option>
          {MOVEMENT_TYPES.map((t) => <option key={t} value={t}>{MOVEMENT_LABELS[t]}</option>)}
        </Select>
        <Select name="source" defaultValue={source ?? ""} aria-label="Source">
          <option value="">All sources</option>
          {MOVEMENT_SOURCES.map((s) => <option key={s} value={s} className="capitalize">{s}</option>)}
        </Select>
        <Input type="date" name="from" defaultValue={from ?? ""} aria-label="From date" />
        <Input type="date" name="to" defaultValue={to ?? ""} aria-label="To date" />
        <Button type="submit" variant="secondary" className="col-span-2 md:col-span-1">Filter</Button>
      </form>
      {product && <p className="mb-3 text-sm text-muted">Showing one product. <Link href="/movements" className="text-primary hover:underline">Show all</Link></p>}

      {error ? (
        <Alert tone="critical">Couldn&apos;t load movements.</Alert>
      ) : (data ?? []).length === 0 ? (
        <Card><EmptyState icon={ArrowLeftRight} title="No movements" description="Stock changes from audits, adjustments, deliveries and POS appear here." /></Card>
      ) : (
        <Card>
          <DataTable>
            <thead><tr><th>When</th><th>Product</th><th>Type</th><th className="text-right">Change</th><th className="text-right">After</th>{manager && <th className="text-right">Value</th>}<th>By</th><th>Details</th></tr></thead>
            <tbody>
              {data!.map((m) => {
                const p = m.products as unknown as { id: string; name: string; unit: string } | null;
                const change = Number(m.quantity_change);
                return (
                  <tr key={m.id}>
                    <td className="whitespace-nowrap text-muted">{formatDateTime(m.created_at, ctx.business.timezone)}</td>
                    <td>{p ? <Link href={`/inventory/${p.id}`} className="font-medium hover:underline">{p.name}</Link> : "—"}</td>
                    <td><Badge tone={change > 0 ? "success" : change < 0 ? "warning" : "neutral"}>{MOVEMENT_LABELS[m.movement_type as MovementType]}</Badge></td>
                    <td className={`tabular text-right font-semibold ${change > 0 ? "text-success" : change < 0 ? "text-critical" : ""}`}>{change > 0 ? "+" : ""}{formatNumber(change)}</td>
                    <td className="tabular text-right">{formatNumber(Number(m.quantity_after))} <span className="text-muted">{p?.unit}</span></td>
                    {manager && <td className="tabular text-right text-muted">{formatMoney(Number(m.value_change), ctx.business.currency)}</td>}
                    <td className="whitespace-nowrap">
                      {(m.actor_id && name.get(m.actor_id)) || (m.source === "pos" ? "POS" : "System")}
                      {m.approved_by && <p className="text-xs text-muted">Approved by {name.get(m.approved_by) ?? "manager"}</p>}
                    </td>
                    <td className="max-w-64 text-xs text-muted">
                      <span className="capitalize">{m.source}</span>
                      {m.ai_confidence !== null && ` · AI ${Math.round(Number(m.ai_confidence) * 100)}%`}
                      {m.input_unit && ` · said ${formatNumber(Number(m.input_quantity))} ${m.input_unit}`}
                      {m.external_ref && ` · ${m.external_ref}`}
                      {m.reason && <p className="truncate">{m.reason}</p>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </DataTable>
        </Card>
      )}
      {(count ?? 0) > PAGE && (
        <nav className="mt-4 flex items-center justify-between text-sm" aria-label="Pagination">
          <span className="text-muted">Page {page} of {Math.ceil((count ?? 0) / PAGE)}</span>
          <div className="flex gap-2">
            {page > 1 && <Button asChild size="sm" variant="outline"><Link href={qs(page - 1)}>Previous</Link></Button>}
            {page * PAGE < (count ?? 0) && <Button asChild size="sm" variant="outline"><Link href={qs(page + 1)}>Next</Link></Button>}
          </div>
        </nav>
      )}
    </>
  );
}
