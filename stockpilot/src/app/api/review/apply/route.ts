import { NextResponse } from "next/server";
import { z } from "zod";
import { authedRoute, fromDbError, readJson } from "@/lib/api/handler";
import { MOVEMENT_TYPES } from "@/lib/domain/types";
import { escalateReviewItem } from "@/lib/services/review";

const item = z.object({
  id: z.uuid(),
  productId: z.uuid(),
  movementType: z.enum(MOVEMENT_TYPES).exclude(["initial"]),
  baseQuantity: z.number().min(-1_000_000).max(1_000_000),
  inputQuantity: z.number().min(-1_000_000).max(1_000_000).nullable().optional(),
  inputUnit: z.string().max(32).nullable().optional(),
  batchId: z.uuid().nullable().optional(),
  batchNumber: z.string().max(64).nullable().optional(),
  expiryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  observedAt: z.iso.datetime({ offset: true }).nullable().optional(),
  auditId: z.uuid().nullable().optional(),
});
const schema = z.object({ items: z.array(item).min(1).max(50) });

export type ApplyResult =
  | { id: string; ok: true; movementId: string; quantityAfter: number; duplicate: boolean }
  | { id: string; ok: false; code: string; message: string; escalated?: boolean };

/** Applies confirmed (optionally edited) review items. Each item is atomic and idempotent. */
export const POST = authedRoute({ rateLimit: { name: "review-apply", limit: 120, windowSeconds: 600 } }, async (request, ctx) => {
  const { items } = await readJson(request, schema);
  const results: ApplyResult[] = [];

  for (const it of items) {
    const { data, error } = await ctx.supabase.rpc("apply_review_item", {
      p_item_id: it.id,
      p_product_id: it.productId,
      p_movement_type: it.movementType,
      p_base_quantity: it.baseQuantity,
      p_input_quantity: it.inputQuantity ?? null,
      p_input_unit: it.inputUnit ?? null,
      p_batch_id: it.batchId ?? null,
      p_batch_number: it.batchNumber ?? null,
      p_expiry_date: it.expiryDate ?? null,
      p_reason: null,
      p_observed_at: it.observedAt ?? null,
      p_audit_id: it.auditId ?? null,
    });
    if (error) {
      const apiError = fromDbError(error);
      let escalated = false;
      if (apiError.code === "approval_required" && ctx.role === "employee") {
        escalated = await escalateReviewItem(ctx, it.id);
      }
      results.push({
        id: it.id,
        ok: false,
        code: apiError.code,
        message: escalated ? "Sent to a manager for approval because the change is large." : apiError.message,
        escalated,
      });
      continue;
    }
    const m = data as { id: string; quantity_after: number; duplicate: boolean };
    results.push({ id: it.id, ok: true, movementId: m.id, quantityAfter: Number(m.quantity_after), duplicate: m.duplicate });
  }
  return NextResponse.json({ results });
});
