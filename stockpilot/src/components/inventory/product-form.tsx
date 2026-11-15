"use client";
import { useRouter } from "next/navigation";
import { useActionState, useEffect } from "react";
import { saveProduct } from "@/app/(app)/inventory/actions";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Alert } from "@/components/ui/feedback";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import { STOCK_UNITS, UNIT_LABELS } from "@/lib/domain/units";

export interface ProductFormValues {
  id?: string;
  name?: string; sku?: string | null; barcode?: string | null; brand?: string | null; category?: string | null;
  description?: string | null; color?: string | null; packageSize?: string | null; synonyms?: string[];
  costPrice?: number; sellingPrice?: number; unit?: string; reorderThreshold?: number; reorderQuantity?: number | null;
  storageLocation?: string | null; preferredSupplierId?: string | null; locationId?: string | null; trackExpiry?: boolean;
}

export function ProductForm({
  values = {},
  suppliers,
  locations,
  categories,
  currency,
}: {
  values?: ProductFormValues;
  suppliers: { id: string; name: string }[];
  locations: { id: string; name: string }[];
  categories: string[];
  currency: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [state, action, pending] = useActionState(saveProduct, null);
  const fe = state && !state.ok ? state.fieldErrors ?? {} : {};
  const isNew = !values.id;

  useEffect(() => {
    if (state?.ok && state.data) {
      toast({ tone: "success", title: state.message ?? "Saved" });
      router.push(`/inventory/${state.data.id}`);
    }
  }, [state, router, toast]);

  return (
    <form action={action} className="space-y-5" noValidate>
      {values.id && <input type="hidden" name="id" value={values.id} />}
      {state && !state.ok && <Alert tone="critical">{state.error}</Alert>}

      <Card>
        <CardHeader title="Basics" description="Clear names and synonyms help StockPilot recognise what employees say." />
        <CardBody className="grid gap-4 sm:grid-cols-2">
          <Field label="Product name" htmlFor="name" error={fe.name} className="sm:col-span-2">
            <Input id="name" name="name" defaultValue={values.name} required maxLength={200} aria-invalid={!!fe.name} placeholder="e.g. AA Alkaline Batteries 4-pack" />
          </Field>
          <Field label="SKU" htmlFor="sku" error={fe.sku}><Input id="sku" name="sku" defaultValue={values.sku ?? ""} maxLength={64} /></Field>
          <Field label="Barcode" htmlFor="barcode" error={fe.barcode}><Input id="barcode" name="barcode" defaultValue={values.barcode ?? ""} inputMode="numeric" maxLength={64} /></Field>
          <Field label="Brand" htmlFor="brand"><Input id="brand" name="brand" defaultValue={values.brand ?? ""} maxLength={120} /></Field>
          <Field label="Category" htmlFor="category" hint="Pick or type a new one.">
            <Input id="category" name="category" defaultValue={values.category ?? ""} list="category-options" maxLength={80} />
            <datalist id="category-options">{categories.map((c) => <option key={c} value={c} />)}</datalist>
          </Field>
          <Field label="Colour" htmlFor="color" hint="e.g. blue pack"><Input id="color" name="color" defaultValue={values.color ?? ""} maxLength={40} /></Field>
          <Field label="Package size" htmlFor="packageSize" hint="e.g. 100 ml, 30 tablets"><Input id="packageSize" name="packageSize" defaultValue={values.packageSize ?? ""} maxLength={60} /></Field>
          <Field label="Other names (synonyms)" htmlFor="synonyms" hint="Comma separated, e.g. kids cough medicine, robitussin" className="sm:col-span-2">
            <Input id="synonyms" name="synonyms" defaultValue={(values.synonyms ?? []).join(", ")} maxLength={600} />
          </Field>
          <Field label="Description" htmlFor="description" className="sm:col-span-2">
            <Textarea id="description" name="description" defaultValue={values.description ?? ""} maxLength={2000} className="min-h-20" />
          </Field>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Stock & pricing" />
        <CardBody className="grid gap-4 sm:grid-cols-3">
          <Field label="Counted in" htmlFor="unit" hint="The base unit. Add packagings (e.g. case of 24) on the product page.">
            <Select id="unit" name="unit" defaultValue={values.unit ?? "piece"}>
              {STOCK_UNITS.map((u) => <option key={u} value={u}>{UNIT_LABELS[u].plural}</option>)}
            </Select>
          </Field>
          <Field label="Reorder when below" htmlFor="reorderThreshold" error={fe.reorderThreshold}>
            <Input id="reorderThreshold" name="reorderThreshold" type="number" min={0} step="any" defaultValue={values.reorderThreshold ?? 0} />
          </Field>
          <Field label="Usual order quantity" htmlFor="reorderQuantity" hint="Optional" error={fe.reorderQuantity}>
            <Input id="reorderQuantity" name="reorderQuantity" type="number" min={0} step="any" defaultValue={values.reorderQuantity ?? ""} />
          </Field>
          <Field label={`Cost price (${currency})`} htmlFor="costPrice" error={fe.costPrice}>
            <Input id="costPrice" name="costPrice" type="number" min={0} step="0.01" defaultValue={values.costPrice ?? ""} />
          </Field>
          <Field label={`Selling price (${currency})`} htmlFor="sellingPrice" error={fe.sellingPrice}>
            <Input id="sellingPrice" name="sellingPrice" type="number" min={0} step="0.01" defaultValue={values.sellingPrice ?? ""} />
          </Field>
          <Field label="Shelf / storage location" htmlFor="storageLocation"><Input id="storageLocation" name="storageLocation" defaultValue={values.storageLocation ?? ""} maxLength={120} placeholder="Aisle 3, top shelf" /></Field>
          <Field label="Preferred supplier" htmlFor="preferredSupplierId">
            <Select id="preferredSupplierId" name="preferredSupplierId" defaultValue={values.preferredSupplierId ?? ""}>
              <option value="">None</option>
              {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
          </Field>
          <Field label="Store location" htmlFor="locationId">
            <Select id="locationId" name="locationId" defaultValue={values.locationId ?? ""}>
              <option value="">—</option>
              {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </Select>
          </Field>
          <label className="flex items-center gap-2 self-end pb-2 text-sm font-medium">
            <input type="checkbox" name="trackExpiry" defaultChecked={values.trackExpiry} className="size-4 accent-[var(--primary)]" /> Track expiry dates
          </label>
        </CardBody>
      </Card>

      {isNew && (
        <Card>
          <CardHeader title="Opening stock" description="Optional. Recorded as an auditable opening-stock movement." />
          <CardBody className="grid gap-4 sm:grid-cols-3">
            <Field label="Quantity on hand" htmlFor="initialQuantity" error={fe.initialQuantity}>
              <Input id="initialQuantity" name="initialQuantity" type="number" min={0} step="any" />
            </Field>
            <Field label="Batch / lot number" htmlFor="batchNumber"><Input id="batchNumber" name="batchNumber" maxLength={64} /></Field>
            <Field label="Expiry date" htmlFor="expiryDate" error={fe.expiryDate}><Input id="expiryDate" name="expiryDate" type="date" /></Field>
          </CardBody>
        </Card>
      )}

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={() => router.back()}>Cancel</Button>
        <Button type="submit" loading={pending}>{isNew ? "Create product" : "Save changes"}</Button>
      </div>
    </form>
  );
}
