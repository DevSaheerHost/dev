"use client";
import { useActionState, useState, useTransition } from "react";
import { Archive, ArchiveRestore, Pencil, Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { addVariant, deleteProduct, deleteVariant, setArchived, updateBatch } from "@/app/(app)/inventory/actions";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Alert } from "@/components/ui/feedback";
import { Field, Input, Select } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import { STOCK_UNITS, UNIT_LABELS } from "@/lib/domain/units";
import { formatNumber } from "@/lib/utils";

export function VariantForm({ productId, baseUnit }: { productId: string; baseUnit: string }) {
  const [state, action, pending] = useActionState(addVariant, null);
  return (
    <form action={action} className="grid gap-3 sm:grid-cols-[1.2fr_1fr_1fr_auto] sm:items-end">
      <input type="hidden" name="productId" value={productId} />
      <Field label="Name" htmlFor="v-name" error={state && !state.ok ? state.fieldErrors?.name : undefined}><Input id="v-name" name="name" placeholder="Case of 24" required /></Field>
      <Field label="Unit" htmlFor="v-unit">
        <Select id="v-unit" name="unit" defaultValue="case">{STOCK_UNITS.map((u) => <option key={u} value={u}>{UNIT_LABELS[u].singular}</option>)}</Select>
      </Field>
      <Field label={`Contains (${baseUnit})`} htmlFor="v-factor" error={state && !state.ok ? state.fieldErrors?.conversionFactor : undefined}>
        <Input id="v-factor" name="conversionFactor" type="number" min={0} step="any" required />
      </Field>
      <Button type="submit" variant="secondary" loading={pending}>Add</Button>
      {state && !state.ok && !state.fieldErrors && <Alert tone="critical" className="sm:col-span-4">{state.error}</Alert>}
    </form>
  );
}

export function DeleteVariantButton({ id, productId }: { id: string; productId: string }) {
  const [pending, start] = useTransition();
  return (
    <button onClick={() => start(async () => void (await deleteVariant(id, productId)))} disabled={pending} className="rounded p-1 text-muted hover:bg-surface-muted hover:text-critical" aria-label="Remove packaging">
      <X className="size-4" />
    </button>
  );
}

export function EditBatchButton({ batch, productId }: { batch: { id: string; batchNumber: string | null; expiryDate: string | null }; productId: string }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(async (prev: Awaited<ReturnType<typeof updateBatch>> | null, fd: FormData) => {
    const r = await updateBatch(prev, fd);
    if (r.ok) setOpen(false);
    return r;
  }, null);
  return (
    <>
      <button onClick={() => setOpen(true)} className="rounded p-1 text-muted hover:bg-surface-muted hover:text-foreground" aria-label="Edit batch"><Pencil className="size-4" /></button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent title="Edit batch" description="Correct the batch number or the printed expiry date.">
          <form action={action} className="space-y-4">
            <input type="hidden" name="id" value={batch.id} />
            <input type="hidden" name="productId" value={productId} />
            {state && !state.ok && <Alert tone="critical">{state.error}</Alert>}
            <Field label="Batch / lot number" htmlFor="b-num"><Input id="b-num" name="batchNumber" defaultValue={batch.batchNumber ?? ""} maxLength={64} /></Field>
            <Field label="Expiry date" htmlFor="b-exp"><Input id="b-exp" name="expiryDate" type="date" defaultValue={batch.expiryDate ?? ""} /></Field>
            <div className="flex justify-end"><Button type="submit" loading={pending}>Save</Button></div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function ProductDangerZone({ productId, archived, isOwner }: { productId: string; archived: boolean; isOwner: boolean }) {
  const router = useRouter();
  const toast = useToast();
  return (
    <div className="flex flex-wrap gap-2">
      <ConfirmDialog
        trigger={<Button variant="outline">{archived ? <ArchiveRestore /> : <Archive />} {archived ? "Restore" : "Archive"}</Button>}
        title={archived ? "Restore product?" : "Archive product?"}
        description={archived ? "It will appear in inventory and audits again." : "Archived products are hidden from inventory and audits. Their history is kept."}
        confirmLabel={archived ? "Restore" : "Archive"}
        onConfirm={async () => {
          const r = await setArchived(productId, !archived);
          toast(r.ok ? { tone: "success", title: r.message ?? "Done" } : { tone: "error", title: r.error });
          router.refresh();
        }}
      />
      {isOwner && (
        <ConfirmDialog
          trigger={<Button variant="ghost" className="text-critical"><Trash2 /> Delete</Button>}
          title="Delete permanently?"
          description="Only possible for products that never had any stock movement. This cannot be undone."
          confirmLabel="Delete"
          tone="destructive"
          onConfirm={async () => {
            const r = await deleteProduct(productId);
            if (r.ok) {
              toast({ tone: "success", title: "Product deleted" });
              router.push("/inventory");
            } else toast({ tone: "error", title: "Not deleted", description: r.error });
          }}
        />
      )}
    </div>
  );
}

export function QuantityText({ value, unit }: { value: number; unit: string }) {
  return <span className="tabular">{formatNumber(value)} {unit}</span>;
}
