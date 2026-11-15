"use client";
import { useRouter } from "next/navigation";
import { useActionState, useState, useTransition } from "react";
import { Plus, X } from "lucide-react";
import { removeSupplierProduct, saveSupplier, saveSupplierProduct } from "@/app/(app)/suppliers/actions";
import { ProductSearch, type PickedProduct } from "@/components/review/product-picker";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Alert } from "@/components/ui/feedback";
import { Field, Input, Textarea } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";

export interface SupplierValues {
  id?: string; name?: string; contactPerson?: string | null; email?: string | null; phone?: string | null;
  whatsappNumber?: string | null; address?: string | null; paymentTerms?: string | null; notes?: string | null;
}

export function SupplierFormDialog({ values = {}, trigger }: { values?: SupplierValues; trigger: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const toast = useToast();
  const [state, action, pending] = useActionState(async (prev: Awaited<ReturnType<typeof saveSupplier>> | null, fd: FormData) => {
    const r = await saveSupplier(prev, fd);
    if (r.ok) {
      setOpen(false);
      toast({ tone: "success", title: r.message ?? "Saved" });
      if (!values.id && r.data) router.push(`/suppliers/${r.data.id}`);
      else router.refresh();
    }
    return r;
  }, null);
  const fe = state && !state.ok ? state.fieldErrors ?? {} : {};

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent title={values.id ? "Edit supplier" : "Add supplier"}>
        <form action={action} className="grid gap-4 sm:grid-cols-2" noValidate>
          {values.id && <input type="hidden" name="id" value={values.id} />}
          {state && !state.ok && <Alert tone="critical" className="sm:col-span-2">{state.error}</Alert>}
          <Field label="Supplier name" htmlFor="s-name" error={fe.name} className="sm:col-span-2"><Input id="s-name" name="name" defaultValue={values.name} required /></Field>
          <Field label="Contact person" htmlFor="s-contact"><Input id="s-contact" name="contactPerson" defaultValue={values.contactPerson ?? ""} /></Field>
          <Field label="Email" htmlFor="s-email" error={fe.email}><Input id="s-email" name="email" type="email" defaultValue={values.email ?? ""} /></Field>
          <Field label="Phone" htmlFor="s-phone"><Input id="s-phone" name="phone" type="tel" defaultValue={values.phone ?? ""} /></Field>
          <Field label="WhatsApp number" htmlFor="s-wa" hint="With country code, e.g. +15550102030" error={fe.whatsappNumber}><Input id="s-wa" name="whatsappNumber" type="tel" defaultValue={values.whatsappNumber ?? ""} /></Field>
          <Field label="Payment terms" htmlFor="s-terms"><Input id="s-terms" name="paymentTerms" defaultValue={values.paymentTerms ?? ""} placeholder="Net 30" /></Field>
          <Field label="Address" htmlFor="s-address"><Input id="s-address" name="address" defaultValue={values.address ?? ""} /></Field>
          <Field label="Notes" htmlFor="s-notes" className="sm:col-span-2"><Textarea id="s-notes" name="notes" defaultValue={values.notes ?? ""} className="min-h-16" /></Field>
          <div className="flex justify-end sm:col-span-2"><Button type="submit" loading={pending}>Save supplier</Button></div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function LinkProductDialog({ supplierId, currency }: { supplierId: string; currency: string }) {
  const [open, setOpen] = useState(false);
  const [product, setProduct] = useState<PickedProduct | null>(null);
  const router = useRouter();
  const [state, action, pending] = useActionState(async (prev: Awaited<ReturnType<typeof saveSupplierProduct>> | null, fd: FormData) => {
    const r = await saveSupplierProduct(prev, fd);
    if (r.ok) {
      setOpen(false);
      setProduct(null);
      router.refresh();
    }
    return r;
  }, null);
  const fe = state && !state.ok ? state.fieldErrors ?? {} : {};
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm" variant="outline"><Plus /> Link product</Button></DialogTrigger>
      <DialogContent title="Link a product" description="Record what this supplier charges and how they pack it.">
        {!product ? (
          <ProductSearch onPick={setProduct} autoFocus />
        ) : (
          <form action={action} className="grid gap-4 sm:grid-cols-2">
            <input type="hidden" name="supplierId" value={supplierId} />
            <input type="hidden" name="productId" value={product.id} />
            {state && !state.ok && <Alert tone="critical" className="sm:col-span-2">{state.error}</Alert>}
            <div className="flex items-center justify-between rounded-lg bg-surface-muted px-3 py-2 text-sm sm:col-span-2">
              <span className="font-medium">{product.name}</span>
              <button type="button" className="text-xs text-primary" onClick={() => setProduct(null)}>Change</button>
            </div>
            <Field label={`Unit cost (${currency})`} htmlFor="sp-cost" error={fe.unitCost}><Input id="sp-cost" name="unitCost" type="number" min={0} step="0.01" required /></Field>
            <Field label={`Pack size (${product.unit ?? "units"})`} htmlFor="sp-pack" hint="Orders round up to whole packs." error={fe.packSize}><Input id="sp-pack" name="packSize" type="number" min={0} step="any" defaultValue={1} /></Field>
            <Field label="Supplier SKU" htmlFor="sp-sku"><Input id="sp-sku" name="supplierSku" /></Field>
            <Field label="Lead time (days)" htmlFor="sp-lead"><Input id="sp-lead" name="leadTimeDays" type="number" min={0} max={365} /></Field>
            <label className="flex items-center gap-2 text-sm font-medium sm:col-span-2"><input type="checkbox" name="preferred" defaultChecked className="size-4 accent-[var(--primary)]" /> Make this the preferred supplier</label>
            <div className="flex justify-end sm:col-span-2"><Button type="submit" loading={pending}>Save</Button></div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function UnlinkButton({ id, supplierId }: { id: string; supplierId: string }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <button disabled={pending} onClick={() => start(async () => { await removeSupplierProduct(id, supplierId); router.refresh(); })} className="rounded p-1 text-muted hover:text-critical" aria-label="Unlink product">
      <X className="size-4" />
    </button>
  );
}
