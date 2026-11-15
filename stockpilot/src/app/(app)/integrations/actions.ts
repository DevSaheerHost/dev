"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireContext } from "@/lib/auth/session";
import { attempt, type ActionResult } from "@/lib/actions";
import { assertRole } from "@/lib/data/business";
import { biz, nowIso } from "@/lib/data/refs";
import { invalid } from "@/lib/errors";
import { PROVIDERS } from "@/lib/integrations/types";

const provider = z.enum(PROVIDERS);

export async function mapExternalProduct(providerName: string, mappingId: string, productId: string | null): Promise<ActionResult> {
  const ctx = await requireContext();
  const r = await attempt(async () => {
    assertRole(ctx, "manager");
    const p = provider.parse(providerName);
    if (!/^[0-9a-f]{40}$/.test(mappingId) || (productId !== null && !/^[A-Za-z0-9_-]{8,64}$/.test(productId))) throw invalid("Invalid selection.");
    if (productId && !(await biz(ctx.business.id).products.doc(productId).get()).exists) throw invalid("Unknown product.");
    await biz(ctx.business.id).mappings(p).doc(mappingId).update({ productId, updatedAt: nowIso() });
  }, "Mapping saved.");
  revalidatePath("/integrations");
  return r;
}

export async function updateIntegrationSettings(providerName: string, conflictPolicy: string, syncEnabled: boolean): Promise<ActionResult> {
  const ctx = await requireContext();
  const r = await attempt(async () => {
    assertRole(ctx, "owner");
    const p = provider.parse(providerName);
    const policy = z.enum(["newest_wins", "pos", "stockpilot"]).parse(conflictPolicy);
    await biz(ctx.business.id).integrations.doc(p).update({ conflictPolicy: policy, syncEnabled: syncEnabled === true, updatedAt: nowIso() });
  }, "Settings saved.");
  revalidatePath("/integrations");
  return r;
}
