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
import { getSupplier, supplierDetail } from "@/lib/data/purchasing";

export const metadata = { title: "Supplier" };

export default async function SupplierPage({ params }: PageProps<"/suppliers/[id]">) {
  const { id } = await params;
  const ctx = await requireRole("manager");
  const s = await getSupplier(ctx.business.id, id);
  if (!s) notFound();
  const { links: mappings, orders, history } = await supplierDetail(ctx.business.id, id);

  return (
    <>
      <PageHeader
        title={s.name}
        back={{ href: "/suppliers", label: "Suppliers" }}
        description={[s.contactPerson, s.email, s.phone, s.paymentTerms].filter(Boolean).join(" · ") || undefined}
        actions={
          <SupplierFormDialog
            trigger={<Button variant="outline"><Pencil /> Edit</Button>}
            values={{ id: s.id, name: s.name, contactPerson: s.contactPerson, email: s.email, phone: s.phone, whatsappNumber: s.whatsappNumber, address: s.address, paymentTerms: s.paymentTerms, notes: s.notes }}
          />
        }
      />
      <div className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
        <Card>
          <CardHeader title="Products supplied" action={<LinkProductDialog supplierId={s.id} currency={ctx.business.currency} />} />
          {mappings.length === 0 ? (
            <CardBody><p className="text-sm text-muted">Link the products this supplier sells to include them in automatic purchase orders.</p></CardBody>
          ) : (
            <DataTable>
              <thead><tr><th>Product</th><th>Supplier SKU</th><th className="text-right">Unit cost</th><th className="text-right">Pack</th><th className="text-right">Lead time</th><th /></tr></thead>
              <tbody>
                {mappings.map((m) => {
                  const p = m.product;
                  return (
                    <tr key={m.id}>
                      <td>
                        {p && <Link href={`/inventory/${p.id}`} className="font-medium hover:underline">{p.name}</Link>}
                        {p?.preferredSupplierId === s.id && <Badge tone="primary" className="ml-2">Preferred</Badge>}
                      </td>
                      <td className="text-muted">{m.supplierSku ?? "—"}</td>
                      <td className="tabular text-right">{formatMoney(m.unitCost, ctx.business.currency)}</td>
                      <td className="tabular text-right">{formatNumber(m.packSize)} {p?.unit}</td>
                      <td className="tabular text-right">{m.leadTimeDays !== null ? `${m.leadTimeDays}d` : "—"}</td>
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
            {orders.length === 0 ? (
              <CardBody><p className="text-sm text-muted">No orders yet.</p></CardBody>
            ) : (
              <ul className="divide-y divide-border">
                {orders.map((o) => (
                  <li key={o.id}>
                    <Link href={`/purchase-orders/${o.id}`} className="flex items-center justify-between gap-3 px-5 py-3 text-sm hover:bg-surface-muted">
                      <span className="font-medium">{o.poNumber}</span>
                      <Badge tone="neutral" className="capitalize">{o.status.replace("_", " ")}</Badge>
                      <span className="tabular">{formatMoney(o.subtotal, ctx.business.currency)}</span>
                      <span className="text-xs text-muted">{formatDate(o.createdAt)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card>
            <CardHeader title="Price history" />
            {history.length === 0 ? (
              <CardBody><p className="text-sm text-muted">Prices are recorded each time a product cost changes.</p></CardBody>
            ) : (
              <ul className="divide-y divide-border text-sm">
                {history.map((h, i) => (
                  <li key={i} className="flex justify-between gap-3 px-5 py-2.5">
                    <span className="truncate">{h.productName}</span>
                    <span className="tabular font-medium">{formatMoney(h.unitCost, ctx.business.currency)}</span>
                    <span className="text-xs text-muted">{formatDate(h.recordedAt)}</span>
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
