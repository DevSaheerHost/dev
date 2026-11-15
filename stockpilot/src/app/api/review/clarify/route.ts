import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, authedRoute, readJson } from "@/lib/api/handler";
import { AiUnavailableError, getAiProvider } from "@/lib/ai/provider";
import { loadCatalog } from "@/lib/data/catalog";
import { getReviewItem, persistVoiceExtraction, rejectReviewItem } from "@/lib/data/review";
import { todayIso } from "@/lib/domain/expiry";

const schema = z.object({ itemId: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/), answer: z.string().trim().min(2).max(1000) });

/** "Ask AI to clarify": the restated command is interpreted afresh and replaces the original suggestion. */
export const POST = authedRoute({ rateLimit: { name: "ai-extract", limit: 60, windowSeconds: 600 } }, async (request, ctx) => {
  const { itemId, answer } = await readJson(request, schema);
  const item = await getReviewItem(ctx, itemId);
  if (!item) throw new ApiError(404, "not_found", "This suggestion no longer exists.");
  if (!item.voiceSessionId) throw new ApiError(400, "not_voice", "Only voice suggestions can be clarified this way. Edit the photo result instead.");
  try {
    const run = await getAiProvider().extractVoice(answer, todayIso(new Date(), ctx.business.timezone), (await loadCatalog(ctx.business.id)).map((p) => p.name));
    const outcome = await persistVoiceExtraction(ctx, item.voiceSessionId, run);
    if (outcome.valid && outcome.items.length > 0) await rejectReviewItem(ctx, itemId, "Clarified", true);
    return NextResponse.json({ supersededId: outcome.items.length > 0 ? itemId : null, transcript: answer, ...outcome });
  } catch (e) {
    if (e instanceof AiUnavailableError) throw new ApiError(503, "ai_unavailable", e.message);
    throw e;
  }
});
