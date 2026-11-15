import Link from "next/link";
import { notFound } from "next/navigation";
import { Pencil } from "lucide-react";
import { LinkProductDialog, SupplierFormDialog, UnlinkButton } from "@/components/suppliers/supplier-forms";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { DataTable, PageHeader } from "@/components/ui/page";
import { requireRole } from "@/lib/auth/session";
import { formatDate, formatMoney, formatNumber } from "@/lib/utils";

export const metadata = { title: "Supplier" };

export default async function SupplierPage({ params }: PageProps<"/suppliers/[id]">) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const ctx = await requireRole("manager");
  const [{ data: s }, { data: mappings }, { data: orders }, { data: history }] = await Promise.all([
    ctx.supabase.from("suppliers").select("*").eq("id", id).eq("business_id", ctx.business.id).maybeSingle(),
    ctx.supabase.from("supplier_products").select("id, supplier_sku, unit_cost, pack_size, lead_time_days, products(id, name, unit, preferred_supplier_id)").eq("supplier_id", id).order("created_at"),
    ctx.supabase.from("purchase_orders").select("id, po_number, status, subtotal, created_at").eq("supplier_id", id).order("created_at", { ascending: false }).limit(20),
    ctx.supabase.from("supplier_price_history").select("unit_cost, recorded_at, products(name)").eq("supplier_id", id).order("recorded_at", { ascending: false }).limit(30),
  ]);
  if (!s) notFound();

  return (
    <>
      <PageHeader
        title={s.name}
        back={{ href: "/suppliers", label: "Suppliers" }}
        description={[s.contact_person, s.email, s.phone, s.payment_terms].filter(Boolean).join(" · ") || undefined}
        actions={
          <SupplierFormDialog
            trigger={<Button variant="outline"><Pencil /> Edit</Button>}
            values={{ id: s.id, name: s.name, contactPerson: s.contact_person, email: s.email, phone: s.phone, whatsappNumber: s.whatsapp_number, address: s.address, paymentTerms: s.payment_terms, notes: s.notes }}
          />
        }
      />
      <div className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
        <Card>
          <CardHeader title="Products supplied" action={<LinkProductDialog supplierId={s.id} currency={ctx.business.currency} />} />
          {(mappings ?? []).length === 0 ? (
            <CardBody><p className="text-sm text-muted">Link the products this supplier sells to include them in automatic purchase orders.</p></CardBody>
          ) : (
            <DataTable>
              <thead><tr><th>Product</th><th>Supplier SKU</th><th className="text-right">Unit cost</th><th className="text-right">Pack</th><th className="text-right">Lead time</th><th /></tr></thead>
              <tbody>
                {mappings!.map((m) => {
                  const p = m.products as unknown as { id: string; name: string; unit: string; preferred_supplier_id: string | null } | null;
                  return (
                    <tr key={m.id}>
                      <td>
                        {p && <Link href={`/inventory/${p.id}`} className="font-medium hover:underline">{p.name}</Link>}
                        {p?.preferred_supplier_id === s.id && <Badge tone="primary" className="ml-2">Preferred</Badge>}
                      </td>
                      <td className="text-muted">{m.supplier_sku ?? "—"}</td>
                      <td className="tabular text-right">{formatMoney(Number(m.unit_cost), ctx.business.currency)}</td>
                      <td className="tabular text-right">{formatNumber(Number(m.pack_size))} {p?.unit}</td>
                      <td className="tabular text-right">{m.lead_time_days !== null ? `${m.lead_time_days}d` : "—"}</td>
                      <td className="text-right"><UnlinkButton id={m.id} supplierId={s.id} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </DataTable>
          )}
        </Card>
        <div className="space-y-6">
          <Card>
            <CardHeader title="Purchase history" />
            {(orders ?? []).length === 0 ? (
              <CardBody><p className="text-sm text-muted">No orders yet.</p></CardBody>
            ) : (
              <ul className="divide-y divide-border">
                {orders!.map((o) => (
                  <li key={o.id}>
                    <Link href={`/purchase-orders/${o.id}`} className="flex items-center justify-between gap-3 px-5 py-3 text-sm hover:bg-surface-muted">
                      <span className="font-medium">{o.po_number}</span>
                      <Badge tone="neutral" className="capitalize">{o.status.replace("_", " ")}</Badge>
                      <span className="tabular">{formatMoney(Number(o.subtotal), ctx.business.currency)}</span>
                      <span className="text-xs text-muted">{formatDate(o.created_at)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card>
            <CardHeader title="Price history" />
            {(history ?? []).length === 0 ? (
              <CardBody><p className="text-sm text-muted">Prices are recorded each time a product cost changes.</p></CardBody>
            ) : (
              <ul className="divide-y divide-border text-sm">
                {history!.map((h, i) => (
                  <li key={i} className="flex justify-between gap-3 px-5 py-2.5">
                    <span className="truncate">{(h.products as unknown as { name: string } | null)?.name}</span>
                    <span className="tabular font-medium">{formatMoney(Number(h.unit_cost), ctx.business.currency)}</span>
                    <span className="text-xs text-muted">{formatDate(h.recorded_at)}</span>
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
