import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, authedRoute, fromDbError, readJson } from "@/lib/api/handler";
import { AiUnavailableError, getAiProvider } from "@/lib/ai/provider";
import { assertTranscript, businessToday, persistVoiceExtraction } from "@/lib/services/extraction";
import { loadCatalog } from "@/lib/services/catalog";

export const maxDuration = 60;

const schema = z.object({
  transcript: z.string().max(5000),
  transcriptSource: z.enum(["browser", "gemini", "manual"]).default("manual"),
  clientDraftId: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/),
  audioPath: z.string().max(300).nullable().optional(),
  durationMs: z.number().int().min(0).max(600_000).nullable().optional(),
  auditId: z.uuid().nullable().optional(),
});

/**
 * Interprets a transcript into proposed stock changes. Nothing is applied:
 * the proposals land in the review queue. Replaying the same clientDraftId
 * (e.g. an offline draft synced twice) returns the original result.
 */
export const POST = authedRoute({ rateLimit: { name: "ai-extract", limit: 60, windowSeconds: 600 } }, async (request, ctx) => {
  const body = await readJson(request, schema);
  const transcript = assertTranscript(body.transcript);
  if (body.audioPath && !body.audioPath.startsWith(`${ctx.business.id}/voice/${ctx.userId}/`)) {
    throw new ApiError(400, "invalid_audio_path", "Invalid recording reference.");
  }

  // Idempotent session creation keyed by the client draft id.
  const { data: existing } = await ctx.supabase
    .from("voice_sessions")
    .select("id, status")
    .eq("business_id", ctx.business.id)
    .eq("client_draft_id", body.clientDraftId)
    .maybeSingle();
  if (existing) {
    return NextResponse.json({ duplicate: true, voiceSessionId: existing.id }, { status: 200 });
  }

  const { data: session, error } = await ctx.supabase
    .from("voice_sessions")
    .insert({
      business_id: ctx.business.id,
      user_id: ctx.userId,
      audit_id: body.auditId ?? null,
      audio_path: body.audioPath ?? null,
      duration_ms: body.durationMs ?? null,
      client_draft_id: body.clientDraftId,
      status: "transcribed",
    })
    .select("id")
    .single();
  if (error?.code === "23505") return NextResponse.json({ duplicate: true }, { status: 200 });
  if (error || !session) throw fromDbError(error);

  const { error: tError } = await ctx.supabase.from("voice_transcriptions").insert({
    business_id: ctx.business.id,
    voice_session_id: session.id,
    text: transcript,
    provider: body.transcriptSource,
    created_by: ctx.userId,
  });
  if (tError) throw fromDbError(tError);

  try {
    const provider = getAiProvider();
    const catalogNames = (await loadCatalog(ctx)).map((p) => p.name);
    const run = await provider.extractVoice(transcript, businessToday(ctx), catalogNames);
    const outcome = await persistVoiceExtraction(ctx, session.id, run);
    await ctx.supabase.from("voice_sessions").update({ status: "extracted" }).eq("id", session.id);
    return NextResponse.json({ voiceSessionId: session.id, transcript, ...outcome });
  } catch (e) {
    if (e instanceof AiUnavailableError) throw new ApiError(503, "ai_unavailable", e.message);
    throw e;
  }
});
