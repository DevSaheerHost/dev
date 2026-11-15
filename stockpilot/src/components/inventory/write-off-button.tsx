"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Field, Input } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import { formatMoney, formatNumber, newClientId } from "@/lib/utils";

/** Records an expired batch as removed from stock (with explicit confirmation and loss shown). */
export function WriteOffButton({ productId, productName, batchId, quantity, unit, unitCost, currency, showCost }: {
  productId: string; productName: string; batchId: string; quantity: number; unit: string; unitCost: number; currency: string; showCost: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [qty, setQty] = useState(String(quantity));
  const [key] = useState(() => newClientId("expire"));
  const n = Number(qty);
  return (
    <ConfirmDialog
      trigger={<Button size="sm" variant="outline"><Trash2 /> Write off</Button>}
      title={`Write off ${productName}?`}
      description="Removes the expired units from stock and records the loss."
      confirmLabel="Write off"
      tone="destructive"
      onConfirm={async () => {
        if (!Number.isFinite(n) || n <= 0 || n > quantity) {
          toast({ tone: "error", title: "Enter a quantity up to what's in the batch" });
          throw new Error("invalid");
        }
        const res = await fetch("/api/stock/movements", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ productId, type: "expire", quantity: n, batchId, idempotencyKey: key, reason: "Expired batch removed" }),
        });
        const body = (await res.json()) as { error?: { message: string } };
        if (!res.ok) {
          toast({ tone: "error", title: "Not recorded", description: body.error?.message });
          return;
        }
        toast({ tone: "success", title: "Expired stock written off" });
        router.refresh();
      }}
    >
      <Field label={`Quantity (${unit})`} htmlFor={`wo-${batchId}`} hint={`Batch has ${formatNumber(quantity)}.`}>
        <Input id={`wo-${batchId}`} inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value.replace(/[^0-9.]/g, ""))} />
      </Field>
      {showCost && Number.isFinite(n) && <p className="mt-3 text-sm text-muted">Estimated loss: <span className="font-semibold text-critical">{formatMoney(n * unitCost, currency)}</span></p>}
    </ConfirmDialog>
  );
}
