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
import { loadPurchaseOrder } from "@/lib/services/purchase-order";
import { formatDateTime, formatMoney, formatNumber } from "@/lib/utils";

export const metadata = { title: "Purchase order" };

export default async function PurchaseOrderPage({ params }: PageProps<"/purchase-orders/[id]">) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const ctx = await requireRole("manager");
  const po = await loadPurchaseOrder(ctx, id);
  if (!po) notFound();
  const env = serverEnv();
  const s = po.suppliers;
  const draft = po.status === "draft";
  const receiving = ["approved", "sent", "partially_received"].includes(po.status);
  const message = buildOrderMessage({
    businessName: ctx.business.name, poNumber: po.po_number, supplierName: s.name, contactPerson: s.contact_person, expectedDate: po.expected_date, notes: po.notes,
    lines: po.purchase_order_items.map((l) => ({ productName: l.products.name, quantity: Number(l.quantity), unit: l.products.unit })),
  });

  return (
    <>
      <PageHeader
        title={po.po_number}
        back={{ href: "/purchase-orders", label: "Purchase orders" }}
        description={<span className="flex flex-wrap items-center gap-2"><PoStatusBadge status={po.status} /> <Link href={`/suppliers/${s.id}`} className="hover:underline">{s.name}</Link></span>}
        actions={
          <OrderActions
            poId={po.id} status={po.status} isOwner={ctx.role === "owner"} canSend message={message}
            mailto={s.email ? mailtoLink(s.email, message.subject, message.body) : null}
            whatsapp={s.whatsapp_number ? whatsappLink(s.whatsapp_number, `${message.subject}\n\n${message.body}`) : null}
            hasEmail={!!s.email && !!env.RESEND_API_KEY && !!env.EMAIL_FROM}
            hasWhatsapp={!!s.whatsapp_number && !!env.WHATSAPP_ACCESS_TOKEN}
          />
        }
      />
      {draft && ctx.role !== "owner" && <Alert tone="info" className="mb-4">The owner must approve this order before it can be sent.</Alert>}
      {po.status === "approved" && !ctx.business.autoSendPurchaseOrders && <Alert tone="info" className="mb-4">Approved. Send it to the supplier when you&apos;re ready — StockPilot never sends orders on its own.</Alert>}

      <div className="grid gap-6 xl:grid-cols-[1.6fr_1fr]">
        <Card>
          <CardHeader title="Lines" action={draft ? <AddLineButton poId={po.id} /> : undefined} />
          <DataTable>
            <thead><tr><th>Product</th><th className="text-right">Qty</th><th className="text-right">Unit cost</th><th className="text-right">Total</th>{receiving || po.status === "received" ? <th className="text-right">Received</th> : null}<th /></tr></thead>
            <tbody>
              {po.purchase_order_items.map((l) => {
                const remaining = Number(l.quantity) - Number(l.received_quantity);
                return (
                  <tr key={l.id}>
                    <td><Link href={`/inventory/${l.products.id}`} className="font-medium hover:underline">{l.products.name}</Link><p className="text-xs text-muted">{l.products.sku}</p></td>
                    <td className="tabular text-right">{formatNumber(Number(l.quantity))} <span className="text-muted">{l.products.unit}</span></td>
                    <td className="tabular text-right">{formatMoney(Number(l.unit_cost), ctx.business.currency)}</td>
                    <td className="tabular text-right font-medium">{formatMoney(Number(l.line_total), ctx.business.currency)}</td>
                    {(receiving || po.status === "received") && <td className="tabular text-right">{formatNumber(Number(l.received_quantity))}</td>}
                    <td className="text-right">
                      {draft && <EditableLine poId={po.id} itemId={l.id} quantity={Number(l.quantity)} unitCost={Number(l.unit_cost)} editable />}
                      {receiving && <ReceiveButton poId={po.id} itemId={l.id} remaining={remaining} unit={l.products.unit} productName={l.products.name} />}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot><tr className="border-t border-border"><td colSpan={3} className="px-4 py-3 text-right font-medium">Estimated total</td><td className="tabular px-4 py-3 text-right font-semibold">{formatMoney(Number(po.subtotal), ctx.business.currency)}</td><td colSpan={2} /></tr></tfoot>
          </DataTable>
        </Card>
        <div className="space-y-6">
          <Card>
            <CardHeader title="Details" />
            <CardBody className="space-y-4">
              <OrderDetailsForm poId={po.id} notes={po.notes ?? ""} expectedDate={po.expected_date ?? ""} editable={draft} />
              <dl className="grid grid-cols-2 gap-3 border-t border-border pt-4 text-sm">
                <dt className="text-muted">Created</dt><dd>{formatDateTime(po.created_at, ctx.business.timezone)}</dd>
                <dt className="text-muted">Approved</dt><dd>{po.approved_at ? formatDateTime(po.approved_at, ctx.business.timezone) : "—"}</dd>
                <dt className="text-muted">Sent</dt><dd>{po.sent_at ? `${formatDateTime(po.sent_at, ctx.business.timezone)} · ${po.sent_via}` : "—"}</dd>
                <dt className="text-muted">Payment terms</dt><dd>{s.payment_terms ?? "—"}</dd>
              </dl>
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}
