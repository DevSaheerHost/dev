import { NextResponse } from "next/server";
import { z } from "zod";
import { authedRoute, fromDbError, readJson } from "@/lib/api/handler";

const schema = z.object({ ids: z.array(z.uuid()).min(1).max(50), note: z.string().max(500).optional() });

export const POST = authedRoute({}, async (request, ctx) => {
  const { ids, note } = await readJson(request, schema);
  for (const id of ids) {
    const { error } = await ctx.supabase.rpc("reject_review_item", { p_item_id: id, p_note: note ?? null, p_superseded: false });
    if (error) throw fromDbError(error);
  }
  return NextResponse.json({ ok: true });
});
