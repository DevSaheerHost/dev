"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Field, Input, Select } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import type { MemberRole, MovementType } from "@/lib/domain/types";
import { enqueue } from "@/lib/offline/queue";
import { formatNumber, newClientId } from "@/lib/utils";

const TYPES: { value: MovementType; label: string; sign: 1 | -1 | 0; managerOnly?: boolean }[] = [
  { value: "set_count", label: "Stock count (set to)", sign: 0 },
  { value: "receive", label: "Received", sign: 1 },
  { value: "sale", label: "Sold", sign: -1 },
  { value: "return", label: "Customer return", sign: 1 },
  { value: "damage", label: "Damaged", sign: -1 },
  { value: "expire", label: "Expired", sign: -1 },
  { value: "missing", label: "Missing / stolen", sign: -1 },
  { value: "correction", label: "Correction (±)", sign: 1, managerOnly: true },
  { value: "transfer", label: "Move to another location", sign: 0, managerOnly: true },
];

export function StockAdjust({
  productId,
  productName,
  unit,
  current,
  role,
  businessId,
  batches,
  locations,
}: {
  productId: string;
  productName: string;
  unit: string;
  current: number;
  role: MemberRole;
  businessId: string;
  batches: { id: string; label: string; quantity: number }[];
  locations: { id: string; name: string }[];
}) {
  const router = useRouter();
  const toast = useToast();
  const [type, setType] = useState<MovementType>("set_count");
  const [qty, setQty] = useState("");
  const [reason, setReason] = useState("");
  const [batchId, setBatchId] = useState("");
  const [batchNumber, setBatchNumber] = useState("");
  const [expiry, setExpiry] = useState("");
  const [toLocation, setToLocation] = useState("");
  const [key, setKey] = useState(() => newClientId("adj"));
  const def = TYPES.find((t) => t.value === type)!;
  const n = Number(qty);
  const valid = qty !== "" && Number.isFinite(n) && (type === "correction" ? n !== 0 : type === "set_count" ? n >= 0 : n > 0) && (type !== "transfer" || !!toLocation);
  const after = type === "set_count" ? n : type === "transfer" ? current : current + def.sign * n;
  const removal = ["sale", "damage", "expire", "missing"].includes(type) || (type === "set_count" && n < current) || (type === "correction" && n < 0);

  async function submit() {
    const payload = {
      productId, type, quantity: n, reason: reason || undefined,
      batchId: batchId || null, batchNumber: ["receive", "return"].includes(type) ? batchNumber || null : null,
      expiryDate: ["receive", "return"].includes(type) ? expiry || null : null, toLocationId: type === "transfer" ? toLocation : null,
      observedAt: type === "set_count" ? new Date().toISOString() : null,
    };
    if (!navigator.onLine) {
      await enqueue({ id: key, kind: "stock_movement", businessId, label: `${def.label}: ${productName} ${qty}`, payload });
      toast({ tone: "info", title: "Saved offline", description: "It will be applied when you're back online. Stock hasn't changed yet." });
    } else {
      const res = await fetch("/api/stock/movements", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...payload, idempotencyKey: key }) });
      const body = (await res.json()) as { error?: { message: string } };
      if (!res.ok) {
        toast({ tone: "error", title: "Not applied", description: body.error?.message });
        return;
      }
      toast({ tone: "success", title: "Stock updated", description: `${productName} is now ${formatNumber(after)} ${unit}.` });
      router.refresh();
    }
    setQty("");
    setReason("");
    setBatchNumber("");
    setExpiry("");
    setKey(newClientId("adj"));
  }

  return (
    <Card>
      <CardHeader title="Adjust stock" description="Every change is logged with your name and reason." />
      <CardBody className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Type" htmlFor="adj-type">
            <Select id="adj-type" value={type} onChange={(e) => setType(e.target.value as MovementType)}>
              {TYPES.filter((t) => !t.managerOnly || role !== "employee").map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </Select>
          </Field>
          <Field label={type === "set_count" ? `Counted (${unit})` : `Quantity (${unit})`} htmlFor="adj-qty">
            <Input id="adj-qty" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value.replace(/[^0-9.\-]/g, ""))} className="tabular" />
          </Field>
          {["receive", "return"].includes(type) && (
            <>
              <Field label="Batch / lot" htmlFor="adj-batch"><Input id="adj-batch" value={batchNumber} onChange={(e) => setBatchNumber(e.target.value)} maxLength={64} /></Field>
              <Field label="Expiry date" htmlFor="adj-exp"><Input id="adj-exp" type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} /></Field>
            </>
          )}
          {["damage", "expire", "sale", "missing", "transfer"].includes(type) && batches.length > 0 && (
            <Field label="Batch" htmlFor="adj-batch-id" hint={type === "transfer" ? undefined : "Leave on automatic to use earliest expiry first."}>
              <Select id="adj-batch-id" value={batchId} onChange={(e) => setBatchId(e.target.value)}>
                <option value="">{type === "transfer" ? "Whole product" : "Automatic (FEFO)"}</option>
                {batches.map((b) => <option key={b.id} value={b.id}>{b.label} · {formatNumber(b.quantity)} left</option>)}
              </Select>
            </Field>
          )}
          {type === "transfer" && (
            <Field label="Move to" htmlFor="adj-loc">
              <Select id="adj-loc" value={toLocation} onChange={(e) => setToLocation(e.target.value)}>
                <option value="">Choose location…</option>
                {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </Select>
            </Field>
          )}
          <Field label="Reason (optional)" htmlFor="adj-reason" className="sm:col-span-2">
            <Input id="adj-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} placeholder="e.g. Weekly count, aisle 4" />
          </Field>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="tabular text-sm text-muted">
            {valid ? <>Stock {formatNumber(current)} → <span className={after < 0 ? "font-semibold text-critical" : "font-semibold text-foreground"}>{formatNumber(after)}</span> {unit}</> : "Enter a quantity"}
          </p>
          {removal ? (
            <ConfirmDialog
              trigger={<Button disabled={!valid || after < 0}>Apply</Button>}
              title="Remove stock?"
              description={`${def.label}: ${productName} goes from ${formatNumber(current)} to ${formatNumber(after)} ${unit}. This is recorded permanently.`}
              confirmLabel="Yes, apply"
              tone="destructive"
              onConfirm={submit}
            />
          ) : (
            <Button disabled={!valid} onClick={submit}>Apply</Button>
          )}
        </div>
      </CardBody>
    </Card>
  );
}
