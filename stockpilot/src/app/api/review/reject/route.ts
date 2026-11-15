import { NextResponse } from "next/server";
import { z } from "zod";
import { authedRoute, readJson } from "@/lib/api/handler";
import { rejectReviewItem } from "@/lib/data/review";

const schema = z.object({ ids: z.array(z.string().regex(/^[A-Za-z0-9_-]{8,64}$/)).min(1).max(50), note: z.string().max(500).optional() });

export const POST = authedRoute({}, async (request, ctx) => {
  const { ids, note } = await readJson(request, schema);
  for (const id of ids) await rejectReviewItem(ctx, id, note ?? null);
  return NextResponse.json({ ok: true });
});
