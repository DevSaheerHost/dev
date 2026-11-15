import Link from "next/link";
import { notFound } from "next/navigation";
import { AddLineButton, EditableLine, OrderActions, OrderDetailsForm, ReceiveButton } from "@/components/purchasing/po-controls";
import { PoStatusBadge } from "@/components/purchasing/po-status";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Alert } from "@/components/ui/feedback";
import { DataTable, PageHeader } from "@/components/ui/page";
import { requireRole } from "@/lib/auth/session";
import { buildOrderMessage, mailtoLink, whatsappLink } from "@/lib/domain/purchase-order-message";
import { serverEnv } from "@/lib/env";
import { getPurchaseOrder, getSupplier } from "@/lib/data/purchasing";
import { formatDateTime, formatMoney, formatNumber } from "@/lib/utils";

export const metadata = { title: "Purchase order" };

export default async function PurchaseOrderPage({ params }: PageProps<"/purchase-orders/[id]">) {
  const { id } = await params;
  const ctx = await requireRole("manager");
  const po = await getPurchaseOrder(ctx.business.id, id);
  if (!po) notFound();
  const env = serverEnv();
  const s = (await getSupplier(ctx.business.id, po.supplierId)) ?? { id: po.supplierId, name: po.supplierName, contactPerson: null, email: null, whatsappNumber: null, paymentTerms: null };
  const draft = po.status === "draft";
  const receiving = ["approved", "sent", "partially_received"].includes(po.status);
  const message = buildOrderMessage({
    businessName: ctx.business.name, poNumber: po.poNumber, supplierName: s.name, contactPerson: s.contactPerson, expectedDate: po.expectedDate, notes: po.notes,
    lines: po.lines.map((l) => ({ productName: l.productName, quantity: l.quantity, unit: l.unit })),
  });

  return (
    <>
      <PageHeader
        title={po.poNumber}
        back={{ href: "/purchase-orders", label: "Purchase orders" }}
        description={<span className="flex flex-wrap items-center gap-2"><PoStatusBadge status={po.status} /> <Link href={`/suppliers/${s.id}`} className="hover:underline">{s.name}</Link></span>}
        actions={
          <OrderActions
            poId={po.id} status={po.status} isOwner={ctx.role === "owner"} canSend message={message}
            mailto={s.email ? mailtoLink(s.email, message.subject, message.body) : null}
            whatsapp={s.whatsappNumber ? whatsappLink(s.whatsappNumber, `${message.subject}\n\n${message.body}`) : null}
            hasEmail={!!s.email && !!env.RESEND_API_KEY && !!env.EMAIL_FROM}
            hasWhatsapp={!!s.whatsappNumber && !!env.WHATSAPP_ACCESS_TOKEN}
          />
        }
      />
      {draft && ctx.role !== "owner" && <Alert tone="info" className="mb-4">The owner must approve this order before it can be sent.</Alert>}
      {po.status === "approved" && <Alert tone="info" className="mb-4">Approved. Send it to the supplier when you&apos;re ready — StockPilot never sends orders on its own.</Alert>}

      <div className="grid gap-6 xl:grid-cols-[1.6fr_1fr]">
        <Card>
          <CardHeader title="Lines" action={draft ? <AddLineButton poId={po.id} /> : undefined} />
          <DataTable>
            <thead><tr><th>Product</th><th className="text-right">Qty</th><th className="text-right">Unit cost</th><th className="text-right">Total</th>{receiving || po.status === "received" ? <th className="text-right">Received</th> : null}<th /></tr></thead>
            <tbody>
              {po.lines.map((l) => {
                const remaining = l.quantity - l.receivedQuantity;
                return (
                  <tr key={l.id}>
                    <td><Link href={`/inventory/${l.productId}`} className="font-medium hover:underline">{l.productName}</Link><p className="text-xs text-muted">{l.sku}</p></td>
                    <td className="tabular text-right">{formatNumber(l.quantity)} <span className="text-muted">{l.unit}</span></td>
                    <td className="tabular text-right">{formatMoney(l.unitCost, ctx.business.currency)}</td>
                    <td className="tabular text-right font-medium">{formatMoney(l.quantity * l.unitCost, ctx.business.currency)}</td>
                    {(receiving || po.status === "received") && <td className="tabular text-right">{formatNumber(l.receivedQuantity)}</td>}
                    <td className="text-right">
                      {draft && <EditableLine poId={po.id} itemId={l.id} quantity={l.quantity} unitCost={l.unitCost} editable />}
                      {receiving && <ReceiveButton poId={po.id} itemId={l.id} remaining={remaining} unit={l.unit} productName={l.productName} />}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot><tr className="border-t border-border"><td colSpan={3} className="px-4 py-3 text-right font-medium">Estimated total</td><td className="tabular px-4 py-3 text-right font-semibold">{formatMoney(po.subtotal, ctx.business.currency)}</td><td colSpan={2} /></tr></tfoot>
          </DataTable>
        </Card>
        <div className="space-y-6">
          <Card>
            <CardHeader title="Details" />
            <CardBody className="space-y-4">
              <OrderDetailsForm poId={po.id} notes={po.notes ?? ""} expectedDate={po.expectedDate ?? ""} editable={draft} />
              <dl className="grid grid-cols-2 gap-3 border-t border-border pt-4 text-sm">
                <dt className="text-muted">Created</dt><dd>{formatDateTime(po.createdAt, ctx.business.timezone)}</dd>
                <dt className="text-muted">Approved</dt><dd>{po.approvedAt ? formatDateTime(po.approvedAt, ctx.business.timezone) : "—"}</dd>
                <dt className="text-muted">Sent</dt><dd>{po.sentAt ? `${formatDateTime(po.sentAt, ctx.business.timezone)} · ${po.sentVia}` : "—"}</dd>
                <dt className="text-muted">Payment terms</dt><dd>{s.paymentTerms ?? "—"}</dd>
              </dl>
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}
