"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireContext } from "@/lib/auth/session";
import { attempt, optionalNumber, optionalText, zodFailure, type ActionResult } from "@/lib/actions";
import * as purchasing from "@/lib/data/purchasing";

const docId = z.string().regex(/^[A-Za-z0-9_-]{8,64}$/);
const supplierSchema = z.object({
  id: docId.optional(),
  name: z.string().trim().min(1, "Name is required.").max(120),
  contactPerson: optionalText(120),
  email: optionalText(254).refine((v) => !v || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v), "Enter a valid email."),
  phone: optionalText(40),
  whatsappNumber: optionalText(20).refine((v) => !v || /^\+?[0-9]{7,15}$/.test(v.replace(/[\s()-]/g, "")), "Digits only, with country code."),
  address: optionalText(500),
  paymentTerms: optionalText(120),
  notes: optionalText(2000),
});

export async function saveSupplier(_: ActionResult<{ id: string }> | null, formData: FormData): Promise<ActionResult<{ id: string }>> {
  const ctx = await requireContext();
  const parsed = supplierSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return zodFailure(parsed.error);
  const { id, ...s } = parsed.data;
  const r = await attempt(async () => ({
    id: await purchasing.saveSupplier(ctx, { ...s, email: s.email?.toLowerCase() ?? null, whatsappNumber: s.whatsappNumber?.replace(/[\s()-]/g, "") ?? null }, id),
  }), id ? "Supplier saved." : "Supplier added.");
  revalidatePath("/suppliers");
  return r;
}

export async function archiveSupplier(id: string): Promise<ActionResult> {
  const ctx = await requireContext();
  const r = await attempt(() => purchasing.archiveSupplier(ctx, id), "Supplier archived.");
  revalidatePath("/suppliers");
  return r;
}

const mappingSchema = z.object({
  supplierId: docId,
  productId: docId,
  supplierSku: optionalText(64),
  unitCost: optionalNumber(0, 1_000_000),
  packSize: optionalNumber(0.001, 1_000_000),
  leadTimeDays: optionalNumber(0, 365),
  preferred: z.preprocess((v) => v === "on" || v === "true", z.boolean()),
});

export async function saveSupplierProduct(_: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const ctx = await requireContext();
  const parsed = mappingSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return zodFailure(parsed.error);
  const m = parsed.data;
  const r = await attempt(() => purchasing.linkSupplierProduct(ctx, { ...m, unitCost: m.unitCost ?? 0, packSize: m.packSize ?? 1, leadTimeDays: m.leadTimeDays === null ? null : Math.round(m.leadTimeDays) }), "Product linked.");
  revalidatePath(`/suppliers/${m.supplierId}`);
  return r;
}

export async function removeSupplierProduct(id: string, supplierId: string): Promise<ActionResult> {
  const ctx = await requireContext();
  const r = await attempt(() => purchasing.unlinkSupplierProduct(ctx, id));
  revalidatePath(`/suppliers/${supplierId}`);
  return r;
}
