import { NextResponse } from "next/server";
import { z } from "zod";
import { authedRoute, readJson } from "@/lib/api/handler";
import { applyMovement } from "@/lib/data/stock";
import { MOVEMENT_TYPES } from "@/lib/domain/types";

const docId = z.string().regex(/^[A-Za-z0-9_-]{8,64}$/);
const schema = z.object({
  productId: docId,
  type: z.enum(MOVEMENT_TYPES),
  quantity: z.number().min(-1_000_000).max(1_000_000),
  idempotencyKey: z.string().regex(/^[A-Za-z0-9:_-]{8,200}$/),
  reason: z.string().max(500).optional(),
  batchId: docId.nullable().optional(),
  batchNumber: z.string().max(64).nullable().optional(),
  expiryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  unitCost: z.number().min(0).max(1_000_000).nullable().optional(),
  toLocationId: docId.nullable().optional(),
  observedAt: z.iso.datetime({ offset: true }).nullable().optional(),
});

/** Manual stock movement (also replays offline adjustments; the key makes retries safe). */
export const POST = authedRoute({ rateLimit: { name: "movement", limit: 240, windowSeconds: 600 } }, async (request, ctx) => {
  const b = await readJson(request, schema);
  const result = await applyMovement(ctx.business.id, ctx.business, { userId: ctx.userId, name: ctx.fullName ?? ctx.email, role: ctx.role }, {
    productId: b.productId, type: b.type, quantity: b.quantity, source: "manual", idempotencyKey: b.idempotencyKey, reason: b.reason ?? null,
    batchId: b.batchId ?? null, batchNumber: b.batchNumber ?? null, expiryDate: b.expiryDate ?? null, unitCost: b.unitCost ?? null,
    toLocationId: b.toLocationId ?? null, observedAt: b.observedAt ?? null,
  });
  return NextResponse.json({ movement: result.movement, duplicate: result.duplicate });
});
