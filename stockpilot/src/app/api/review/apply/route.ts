import { NextResponse } from "next/server";
import { z } from "zod";
import { authedRoute, readJson } from "@/lib/api/handler";
import { applyReviewItem, escalateReviewItem } from "@/lib/data/review";
import { AppError } from "@/lib/errors";

const docId = z.string().regex(/^[A-Za-z0-9_-]{8,64}$/);
const item = z.object({
  id: docId,
  productId: docId,
  movementType: z.enum(["receive", "sale", "return", "set_count", "damage", "expire", "missing", "correction"]),
  baseQuantity: z.number().min(-1_000_000).max(1_000_000),
  inputQuantity: z.number().min(-1_000_000).max(1_000_000).nullable().optional(),
  inputUnit: z.string().max(32).nullable().optional(),
  batchId: docId.nullable().optional(),
  batchNumber: z.string().max(64).nullable().optional(),
  expiryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  observedAt: z.iso.datetime({ offset: true }).nullable().optional(),
});
const schema = z.object({ items: z.array(item).min(1).max(50) });

export type ApplyResult =
  | { id: string; ok: true; movementId: string; quantityAfter: number; duplicate: boolean }
  | { id: string; ok: false; code: string; message: string; escalated?: boolean };

/** Applies confirmed (optionally edited) suggestions. Each is atomic and idempotent. */
export const POST = authedRoute({ rateLimit: { name: "review-apply", limit: 120, windowSeconds: 600 } }, async (request, ctx) => {
  const { items } = await readJson(request, schema);
  const results: ApplyResult[] = [];
  for (const it of items) {
    try {
      const r = await applyReviewItem(ctx, it);
      results.push({ id: it.id, ok: true, movementId: r.movement.id, quantityAfter: r.movement.quantityAfter, duplicate: r.duplicate });
    } catch (e) {
      if (!(e instanceof AppError)) {
        console.error("Apply failed", e);
        results.push({ id: it.id, ok: false, code: "internal", message: "Couldn't apply this change." });
        continue;
      }
      const escalated = e.code === "approval_required" && ctx.role === "employee" ? await escalateReviewItem(ctx, it.id) : false;
      results.push({ id: it.id, ok: false, code: e.code, message: escalated ? "Sent to a manager for approval because the change is large." : e.message, escalated });
    }
  }
  return NextResponse.json({ results });
});
