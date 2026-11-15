"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { hasRole, requireContext } from "@/lib/auth/session";
import { dbFailure, optionalNumber, optionalText, zodFailure, type ActionResult } from "@/lib/actions";

const supplierSchema = z.object({
  id: z.uuid().optional(),
  name: z.string().trim().min(1, "Name is required.").max(120),
  contactPerson: optionalText(120),
  email: optionalText(254).refine((v) => !v || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v), "Enter a valid email."),
  phone: optionalText(40),
  whatsappNumber: optionalText(20).refine((v) => !v || /^\+?[0-9]{7,15}$/.test(v.replace(/[\s()-]/g, "")), "Digits only, with country code."),
  address: optionalText(500),
  paymentTerms: optionalText(120),
  notes: optionalText(2000),
});

async function managerContext() {
  const ctx = await requireContext();
  return hasRole(ctx.role, "manager") ? ctx : null;
}

export async function saveSupplier(_: ActionResult<{ id: string }> | null, formData: FormData): Promise<ActionResult<{ id: string }>> {
  const ctx = await managerContext();
  if (!ctx) return { ok: false, error: "Only managers and owners can manage suppliers." };
  const parsed = supplierSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return zodFailure(parsed.error);
  const s = parsed.data;
  const row = {
    name: s.name, contact_person: s.contactPerson, email: s.email?.toLowerCase() ?? null, phone: s.phone,
    whatsapp_number: s.whatsappNumber ? s.whatsappNumber.replace(/[\s()-]/g, "") : null,
    address: s.address, payment_terms: s.paymentTerms, notes: s.notes,
  };
  if (s.id) {
    const { error } = await ctx.supabase.from("suppliers").update(row).eq("id", s.id).eq("business_id", ctx.business.id);
    if (error) return dbFailure(error);
    revalidatePath(`/suppliers/${s.id}`);
    return { ok: true, data: { id: s.id }, message: "Supplier saved." };
  }
  const { data, error } = await ctx.supabase.from("suppliers").insert({ ...row, business_id: ctx.business.id }).select("id").single();
  if (error || !data) return dbFailure(error);
  revalidatePath("/suppliers");
  return { ok: true, data: { id: data.id }, message: "Supplier added." };
}

export async function archiveSupplier(id: string): Promise<ActionResult> {
  const ctx = await managerContext();
  if (!ctx || !z.uuid().safeParse(id).success) return { ok: false, error: "Not allowed." };
  const { error } = await ctx.supabase.from("suppliers").update({ archived_at: new Date().toISOString() }).eq("id", id).eq("business_id", ctx.business.id);
  if (error) return dbFailure(error);
  revalidatePath("/suppliers");
  return { ok: true, message: "Supplier archived." };
}

const mappingSchema = z.object({
  supplierId: z.uuid(),
  productId: z.uuid({ message: "Choose a product." }),
  supplierSku: optionalText(64),
  unitCost: optionalNumber(0, 1_000_000),
  packSize: optionalNumber(0.001, 1_000_000),
  leadTimeDays: optionalNumber(0, 365),
  preferred: z.preprocess((v) => v === "on" || v === "true", z.boolean()),
});

export async function saveSupplierProduct(_: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const ctx = await managerContext();
  if (!ctx) return { ok: false, error: "Not allowed." };
  const parsed = mappingSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return zodFailure(parsed.error);
  const m = parsed.data;
  const { error } = await ctx.supabase.from("supplier_products").upsert(
    {
      business_id: ctx.business.id, supplier_id: m.supplierId, product_id: m.productId, supplier_sku: m.supplierSku,
      unit_cost: m.unitCost ?? 0, pack_size: m.packSize ?? 1, lead_time_days: m.leadTimeDays === null ? null : Math.round(m.leadTimeDays),
    },
    { onConflict: "supplier_id,product_id" },
  );
  if (error) return dbFailure(error);
  if (m.preferred) {
    const { error: pErr } = await ctx.supabase.from("products").update({ preferred_supplier_id: m.supplierId }).eq("id", m.productId).eq("business_id", ctx.business.id);
    if (pErr) return dbFailure(pErr);
  }
  revalidatePath(`/suppliers/${m.supplierId}`);
  return { ok: true, message: "Product linked." };
}

export async function removeSupplierProduct(id: string, supplierId: string): Promise<ActionResult> {
  const ctx = await managerContext();
  if (!ctx || !z.uuid().safeParse(id).success) return { ok: false, error: "Not allowed." };
  const { error } = await ctx.supabase.from("supplier_products").delete().eq("id", id).eq("business_id", ctx.business.id);
  if (error) return dbFailure(error);
  revalidatePath(`/suppliers/${supplierId}`);
  return { ok: true };
}
