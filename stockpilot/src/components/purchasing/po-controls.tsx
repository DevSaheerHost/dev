"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Ban, CheckCircle2, Copy, FileDown, Mail, MessageCircle, PackageCheck, Plus, Send, Sparkles, Trash2 } from "lucide-react";
import { addLine, createManualOrder, generateDraftOrders, receiveLine, removeLine, sendOrder, transitionOrder, updateLine, updateOrderDetails } from "@/app/(app)/purchase-orders/actions";
import { ProductSearch } from "@/components/review/product-picker";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import { formatNumber, newClientId } from "@/lib/utils";

type Result = { ok: true; message?: string } | { ok: false; error: string };

function useAction() {
  const toast = useToast();
  const router = useRouter();
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<Result>, success?: string) =>
    start(async () => {
      const r = await fn();
      if (r.ok) {
        if (r.message || success) toast({ tone: "success", title: r.message ?? success! });
        router.refresh();
      } else toast({ tone: "error", title: "Couldn't do that", description: r.error });
    });
  return { pending, run };
}

export function GenerateDraftsButton({ count }: { count: number }) {
  const { pending, run } = useAction();
  return (
    <ConfirmDialog
      trigger={<Button disabled={count === 0 || pending}><Sparkles /> Create {count || ""} draft {count === 1 ? "order" : "orders"}</Button>}
      title="Create draft purchase orders?"
      description="Drafts are created per supplier for the owner to approve. Nothing is sent to suppliers."
      confirmLabel="Create drafts"
      onConfirm={() => run(generateDraftOrders)}
    />
  );
}

export function NewOrderButton({ suppliers }: { suppliers: { id: string; name: string }[] }) {
  const [supplier, setSupplier] = useState("");
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  return (
    <Dialog>
      <DialogTrigger asChild><Button variant="outline"><Plus /> New order</Button></DialogTrigger>
      <DialogContent title="New purchase order" description="Start a draft for a supplier, then add lines.">
        <Field label="Supplier" htmlFor="po-supplier">
          <Select id="po-supplier" value={supplier} onChange={(e) => setSupplier(e.target.value)}>
            <option value="">Choose…</option>
            {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>
        </Field>
        <div className="mt-4 flex justify-end">
          <Button disabled={!supplier} loading={pending} onClick={() => start(async () => {
            const r = await createManualOrder(supplier);
            if (r.ok && r.data) router.push(`/purchase-orders/${r.data.id}`);
            else if (!r.ok) toast({ tone: "error", title: r.error });
          })}>Create draft</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function EditableLine({ poId, itemId, quantity, unitCost, editable }: { poId: string; itemId: string; quantity: number; unitCost: number; editable: boolean }) {
  const [q, setQ] = useState(String(quantity));
  const [c, setC] = useState(String(unitCost));
  const { pending, run } = useAction();
  if (!editable) return null;
  const dirty = Number(q) !== quantity || Number(c) !== unitCost;
  return (
    <div className="flex items-center gap-2">
      <Input aria-label="Quantity" value={q} onChange={(e) => setQ(e.target.value.replace(/[^0-9.]/g, ""))} className="tabular h-8 w-20" inputMode="decimal" />
      <Input aria-label="Unit cost" value={c} onChange={(e) => setC(e.target.value.replace(/[^0-9.]/g, ""))} className="tabular h-8 w-24" inputMode="decimal" />
      {dirty && <Button size="sm" variant="secondary" loading={pending} onClick={() => run(() => updateLine({ poId, itemId, quantity: Number(q), unitCost: Number(c) }))}>Save</Button>}
      <button className="rounded p-1 text-muted hover:text-critical" aria-label="Remove line" disabled={pending} onClick={() => run(() => removeLine(poId, itemId))}><Trash2 className="size-4" /></button>
    </div>
  );
}

export function AddLineButton({ poId }: { poId: string }) {
  const [open, setOpen] = useState(false);
  const { run } = useAction();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm" variant="outline"><Plus /> Add line</Button></DialogTrigger>
      <DialogContent title="Add a product">
        <ProductSearch autoFocus onPick={(p) => { setOpen(false); run(() => addLine(poId, p.id)); }} />
      </DialogContent>
    </Dialog>
  );
}

export function OrderDetailsForm({ poId, notes, expectedDate, editable }: { poId: string; notes: string; expectedDate: string; editable: boolean }) {
  const [n, setN] = useState(notes);
  const [d, setD] = useState(expectedDate);
  const { pending, run } = useAction();
  return (
    <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
      <Field label="Notes for supplier" htmlFor="po-notes"><Textarea id="po-notes" value={n} onChange={(e) => setN(e.target.value)} disabled={!editable} className="min-h-16" maxLength={2000} /></Field>
      <Field label="Deliver by" htmlFor="po-date"><Input id="po-date" type="date" value={d} onChange={(e) => setD(e.target.value)} disabled={!editable} /></Field>
      {editable && (n !== notes || d !== expectedDate) && (
        <div className="sm:col-span-2"><Button size="sm" variant="secondary" loading={pending} onClick={() => run(() => updateOrderDetails(poId, n, d), "Saved")}>Save details</Button></div>
      )}
    </div>
  );
}

export function OrderActions({ poId, status, isOwner, canSend, message, mailto, whatsapp, hasEmail, hasWhatsapp }: {
  poId: string; status: string; isOwner: boolean; canSend: boolean; message: { subject: string; body: string };
  mailto: string | null; whatsapp: string | null; hasEmail: boolean; hasWhatsapp: boolean;
}) {
  const { pending, run } = useAction();
  const toast = useToast();
  return (
    <div className="flex flex-wrap gap-2">
      <Button asChild variant="outline"><a href={`/api/purchase-orders/${poId}/pdf`}><FileDown /> PDF</a></Button>
      {status === "draft" && isOwner && (
        <ConfirmDialog trigger={<Button disabled={pending}><CheckCircle2 /> Approve</Button>} title="Approve this order?" description="Approved orders can be sent to the supplier. Lines can no longer be edited." confirmLabel="Approve" onConfirm={() => run(() => transitionOrder(poId, "approve"))} />
      )}
      {status === "approved" && canSend && (
        <Dialog>
          <DialogTrigger asChild><Button><Send /> Send to supplier</Button></DialogTrigger>
          <DialogContent title="Send purchase order" description="Review the message. Nothing is sent until you choose a channel.">
            <div className="rounded-lg border border-border bg-surface-muted p-3 text-sm">
              <p className="font-semibold">{message.subject}</p>
              <pre className="mt-2 whitespace-pre-wrap font-sans text-muted">{message.body}</pre>
            </div>
            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              {hasEmail && <Button loading={pending} onClick={() => run(() => sendOrder(poId, "email"))}><Mail /> Send email</Button>}
              {hasWhatsapp && <Button variant="outline" loading={pending} onClick={() => run(() => sendOrder(poId, "whatsapp"))}><MessageCircle /> Send WhatsApp</Button>}
              {mailto && <Button asChild variant="outline"><a href={mailto}><Mail /> Open in my email app</a></Button>}
              {whatsapp && <Button asChild variant="outline"><a href={whatsapp} target="_blank" rel="noopener noreferrer"><MessageCircle /> Open WhatsApp</a></Button>}
              <Button variant="ghost" onClick={async () => { await navigator.clipboard.writeText(`${message.subject}\n\n${message.body}`); toast({ tone: "success", title: "Copied" }); }}><Copy /> Copy text</Button>
              <ConfirmDialog trigger={<Button variant="ghost">I sent it myself</Button>} title="Mark as sent?" description="Use this after sending the order outside StockPilot." confirmLabel="Mark sent" onConfirm={() => run(() => transitionOrder(poId, "mark_sent", "manual"))} />
            </div>
          </DialogContent>
        </Dialog>
      )}
      {!["received", "cancelled"].includes(status) && (status === "draft" || isOwner) && (
        <ConfirmDialog trigger={<Button variant="ghost" className="text-critical"><Ban /> Cancel order</Button>} title="Cancel this order?" confirmLabel="Cancel order" tone="destructive" onConfirm={() => run(() => transitionOrder(poId, "cancel"))} />
      )}
    </div>
  );
}

export function ReceiveButton({ poId, itemId, remaining, unit, productName }: { poId: string; itemId: string; remaining: number; unit: string; productName: string }) {
  const [open, setOpen] = useState(false);
  const [qty, setQty] = useState(String(Math.max(remaining, 0)));
  const [batch, setBatch] = useState("");
  const [expiry, setExpiry] = useState("");
  const [key] = useState(() => newClientId("rcv"));
  const { pending, run } = useAction();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm" variant="outline"><PackageCheck /> Receive</Button></DialogTrigger>
      <DialogContent title={`Receive ${productName}`} description={`${formatNumber(remaining)} ${unit} still expected.`}>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label={`Quantity (${unit})`} htmlFor={`r-q-${itemId}`}><Input id={`r-q-${itemId}`} value={qty} onChange={(e) => setQty(e.target.value.replace(/[^0-9.]/g, ""))} inputMode="decimal" /></Field>
          <Field label="Batch / lot" htmlFor={`r-b-${itemId}`}><Input id={`r-b-${itemId}`} value={batch} onChange={(e) => setBatch(e.target.value)} /></Field>
          <Field label="Expiry" htmlFor={`r-e-${itemId}`}><Input id={`r-e-${itemId}`} type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} /></Field>
        </div>
        <div className="mt-4 flex justify-end">
          <Button loading={pending} disabled={!(Number(qty) > 0)} onClick={() => { run(() => receiveLine({ poId, itemId, quantity: Number(qty), batchNumber: batch, expiryDate: expiry, key })); setOpen(false); }}>Record delivery</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
