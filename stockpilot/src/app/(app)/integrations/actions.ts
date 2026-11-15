"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { hasRole, requireContext } from "@/lib/auth/session";
import { dbFailure, type ActionResult } from "@/lib/actions";

export async function mapExternalProduct(mappingId: string, productId: string | null): Promise<ActionResult> {
  const ctx = await requireContext();
  if (!hasRole(ctx.role, "manager")) return { ok: false, error: "Not allowed." };
  if (!z.uuid().safeParse(mappingId).success || (productId !== null && !z.uuid().safeParse(productId).success)) return { ok: false, error: "Invalid selection." };
  const { error } = await ctx.supabase.from("integration_product_mappings").update({ product_id: productId }).eq("id", mappingId).eq("business_id", ctx.business.id);
  if (error) return dbFailure(error);
  revalidatePath("/integrations");
  return { ok: true, message: "Mapping saved." };
}

export async function updateIntegrationSettings(integrationId: string, conflictPolicy: string, syncEnabled: boolean): Promise<ActionResult> {
  const ctx = await requireContext();
  const policy = z.enum(["newest_wins", "pos", "stockpilot"]).safeParse(conflictPolicy);
  if (ctx.role !== "owner" || !policy.success || !z.uuid().safeParse(integrationId).success) return { ok: false, error: "Not allowed." };
  const { error } = await ctx.supabase.from("integrations").update({ conflict_policy: policy.data, sync_enabled: syncEnabled }).eq("id", integrationId).eq("business_id", ctx.business.id);
  if (error) return dbFailure(error);
  revalidatePath("/integrations");
  return { ok: true, message: "Settings saved." };
}
