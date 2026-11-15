import Link from "next/link";
import { AlertTriangle, ClipboardList } from "lucide-react";
import { GenerateDraftsButton, NewOrderButton } from "@/components/purchasing/po-controls";
import { PoStatusBadge } from "@/components/purchasing/po-status";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Alert, EmptyState } from "@/components/ui/feedback";
import { DataTable, PageHeader } from "@/components/ui/page";
import { requireRole } from "@/lib/auth/session";
import { loadReorderPlan } from "@/lib/services/reorder";
import { formatDate, formatMoney, formatNumber } from "@/lib/utils";

export const metadata = { title: "Purchase orders" };

export default async function PurchaseOrdersPage() {
  const ctx = await requireRole("manager");
  const [plan, { data: orders }, { data: suppliers }] = await Promise.all([
    loadReorderPlan(ctx),
    ctx.supabase.from("purchase_orders").select("id, po_number, status, subtotal, created_at, generated_by_ai, suppliers(name), purchase_order_items(count)").eq("business_id", ctx.business.id).order("created_at", { ascending: false }).limit(100),
    ctx.supabase.from("suppliers").select("id, name").eq("business_id", ctx.business.id).is("archived_at", null).order("name"),
  ]);

  return (
    <>
      <PageHeader title="Purchase orders" description="Orders are drafted automatically from low stock and sent only after the owner approves." actions={<NewOrderButton suppliers={suppliers ?? []} />} />

      <Card className="mb-6">
        <CardHeader
          title="Suggested reorders"
          description={plan.orders.length ? `${plan.orders.reduce((s, o) => s + o.lines.length, 0)} low-stock products across ${plan.orders.length} suppliers` : "Everything is above its reorder level."}
          action={<GenerateDraftsButton count={plan.orders.length} />}
        />
        {plan.orders.length > 0 && (
          <div className="divide-y divide-border">
            {plan.orders.map((o) => (
              <div key={o.supplierId} className="px-5 py-4">
                <div className="mb-2 flex items-center justify-between text-sm">
                  <span className="font-semibold">{o.supplierName}</span>
                  <span className="tabular text-muted">Estimated {formatMoney(o.estimatedTotal, ctx.business.currency)}</span>
                </div>
                <ul className="grid gap-1 text-sm sm:grid-cols-2">
                  {o.lines.map((l) => (
                    <li key={l.productId} className="flex justify-between gap-3 rounded-md bg-surface-muted/60 px-3 py-1.5">
                      <span className="truncate">{l.productName}</span>
                      <span className="tabular shrink-0 font-medium">{formatNumber(l.quantity)} {l.unit}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
        {plan.unassigned.length > 0 && (
          <CardBody className="border-t border-border">
            <Alert tone="warning" title={`${plan.unassigned.length} low-stock products have no preferred supplier`}>
              {plan.unassigned.slice(0, 6).map((u) => <Link key={u.productId} href={`/inventory/${u.productId}/edit`} className="mr-2">{u.productName}</Link>)}
            </Alert>
          </CardBody>
        )}
        {plan.alreadyOnOrder > 0 && <CardBody className="border-t border-border py-3 text-xs text-muted"><AlertTriangle className="mr-1 inline size-3.5" />{plan.alreadyOnOrder} low-stock products are already on an open order and were left out.</CardBody>}
      </Card>

      {(orders ?? []).length === 0 ? (
        <Card><EmptyState icon={ClipboardList} title="No purchase orders yet" description="Create drafts from the suggestions above, or start a new order." /></Card>
      ) : (
        <Card>
          <DataTable>
            <thead><tr><th>Order</th><th>Supplier</th><th>Status</th><th className="text-right">Lines</th><th className="text-right">Total</th><th>Created</th></tr></thead>
            <tbody>
              {orders!.map((o) => (
                <tr key={o.id}>
                  <td><Link href={`/purchase-orders/${o.id}`} className="font-medium hover:underline">{o.po_number}</Link>{o.generated_by_ai && <span className="ml-2 text-xs text-muted">auto</span>}</td>
                  <td>{(o.suppliers as unknown as { name: string } | null)?.name}</td>
                  <td><PoStatusBadge status={o.status as "draft"} /></td>
                  <td className="tabular text-right">{(o.purchase_order_items as unknown as { count: number }[])[0]?.count ?? 0}</td>
                  <td className="tabular text-right">{formatMoney(Number(o.subtotal), ctx.business.currency)}</td>
                  <td className="text-muted">{formatDate(o.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        </Card>
      )}
    </>
  );
}
