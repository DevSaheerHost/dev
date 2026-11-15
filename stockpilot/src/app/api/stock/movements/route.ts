import { NextResponse } from "next/server";
import { z } from "zod";
import { authedRoute, fromDbError, readJson } from "@/lib/api/handler";
import { MOVEMENT_TYPES } from "@/lib/domain/types";

const schema = z.object({
  productId: z.uuid(),
  type: z.enum(MOVEMENT_TYPES),
  quantity: z.number().min(-1_000_000).max(1_000_000),
  idempotencyKey: z.string().regex(/^[A-Za-z0-9:_-]{8,200}$/),
  reason: z.string().max(500).optional(),
  batchId: z.uuid().nullable().optional(),
  batchNumber: z.string().max(64).nullable().optional(),
  expiryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  unitCost: z.number().min(0).max(1_000_000).nullable().optional(),
  toLocationId: z.uuid().nullable().optional(),
  observedAt: z.iso.datetime({ offset: true }).nullable().optional(),
});

/** Manual stock movement (also used to replay offline adjustments). */
export const POST = authedRoute({ rateLimit: { name: "movement", limit: 240, windowSeconds: 600 } }, async (request, ctx) => {
  const body = await readJson(request, schema);
  const { data, error } = await ctx.supabase.rpc("apply_stock_movement", {
    p_business_id: ctx.business.id,
    p_product_id: body.productId,
    p_type: body.type,
    p_quantity: body.quantity,
    p_idempotency_key: body.idempotencyKey,
    p_source: "manual",
    p_reason: body.reason ?? null,
    p_batch_id: body.batchId ?? null,
    p_batch_number: body.batchNumber ?? null,
    p_expiry_date: body.expiryDate ?? null,
    p_unit_cost: body.unitCost ?? null,
    p_to_location_id: body.toLocationId ?? null,
    p_observed_at: body.observedAt ?? null,
  });
  if (error) throw fromDbError(error);
  return NextResponse.json({ movement: data });
});
