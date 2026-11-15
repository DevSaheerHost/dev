import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, authedRoute, fromDbError, readJson } from "@/lib/api/handler";
import { AiUnavailableError, getAiProvider } from "@/lib/ai/provider";
import { assertTranscript, businessToday, persistVoiceExtraction } from "@/lib/services/extraction";
import { loadCatalog } from "@/lib/services/catalog";

const schema = z.object({ itemId: z.uuid(), answer: z.string().min(2).max(1000) });

/**
 * "Ask AI to clarify": the employee restates the change more precisely. The
 * answer is interpreted as a fresh command in the same voice session and the
 * original suggestion is marked superseded.
 */
export const POST = authedRoute({ rateLimit: { name: "ai-extract", limit: 60, windowSeconds: 600 } }, async (request, ctx) => {
  const { itemId, answer } = await readJson(request, schema);
  const { data: item } = await ctx.supabase
    .from("ai_review_queue")
    .select("id, status, extraction_id, ai_extractions(voice_session_id)")
    .eq("id", itemId)
    .maybeSingle();
  if (!item) throw new ApiError(404, "not_found", "This suggestion no longer exists.");
  const voiceSessionId = (item.ai_extractions as unknown as { voice_session_id: string | null } | null)?.voice_session_id;
  if (!voiceSessionId) throw new ApiError(400, "not_voice", "Only voice suggestions can be clarified this way. Edit the photo result instead.");

  const transcript = assertTranscript(answer);
  try {
    const run = await getAiProvider().extractVoice(transcript, businessToday(ctx), (await loadCatalog(ctx)).map((p) => p.name));
    const outcome = await persistVoiceExtraction(ctx, voiceSessionId, run);
    if (outcome.valid && outcome.items.length > 0) {
      const { error } = await ctx.supabase.rpc("reject_review_item", { p_item_id: itemId, p_note: "Clarified", p_superseded: true });
      if (error) throw fromDbError(error);
    }
    return NextResponse.json({ supersededId: outcome.items.length > 0 ? itemId : null, transcript, ...outcome });
  } catch (e) {
    if (e instanceof AiUnavailableError) throw new ApiError(503, "ai_unavailable", e.message);
    throw e;
  }
});
