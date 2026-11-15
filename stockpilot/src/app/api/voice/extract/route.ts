import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, authedRoute, readJson } from "@/lib/api/handler";
import { AiUnavailableError, getAiProvider } from "@/lib/ai/provider";
import { loadCatalog } from "@/lib/data/catalog";
import { biz, nowIso } from "@/lib/data/refs";
import { persistVoiceExtraction } from "@/lib/data/review";
import { todayIso } from "@/lib/domain/expiry";
import { hashId } from "@/lib/firebase/ids";

export const maxDuration = 60;

const schema = z.object({
  transcript: z.string().max(5000),
  transcriptSource: z.enum(["browser", "gemini", "manual"]).default("manual"),
  clientDraftId: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/),
  audioPath: z.string().max(300).nullable().optional(),
  durationMs: z.number().int().min(0).max(600_000).nullable().optional(),
});

/**
 * Interprets a transcript into proposed stock changes for review. Nothing is
 * applied. Replaying the same clientDraftId (an offline draft synced twice)
 * is recognised and not processed again.
 */
export const POST = authedRoute({ rateLimit: { name: "ai-extract", limit: 60, windowSeconds: 600 } }, async (request, ctx) => {
  const body = await readJson(request, schema);
  const transcript = body.transcript.replace(/\s+/g, " ").trim();
  if (transcript.length < 2) throw new ApiError(400, "empty_transcript", "Say or type what changed first.");
  if (body.audioPath && !body.audioPath.startsWith(`${ctx.business.id}/voice/${ctx.userId}/`)) throw new ApiError(400, "invalid_audio_path", "Invalid recording reference.");

  const sessionRef = biz(ctx.business.id).voiceSessions.doc(hashId(ctx.userId, body.clientDraftId));
  try {
    await sessionRef.create({ userId: ctx.userId, transcript, transcriptSource: body.transcriptSource, audioPath: body.audioPath ?? null, durationMs: body.durationMs ?? null, clientDraftId: body.clientDraftId, status: "transcribed", createdAt: nowIso() });
  } catch (e) {
    if ((e as { code?: number }).code === 6) return NextResponse.json({ duplicate: true, voiceSessionId: sessionRef.id });
    throw e;
  }

  try {
    const provider = getAiProvider();
    const catalogNames = (await loadCatalog(ctx.business.id)).map((p) => p.name);
    const run = await provider.extractVoice(transcript, todayIso(new Date(), ctx.business.timezone), catalogNames);
    const outcome = await persistVoiceExtraction(ctx, sessionRef.id, run);
    await sessionRef.update({ status: "extracted" });
    return NextResponse.json({ voiceSessionId: sessionRef.id, transcript, ...outcome });
  } catch (e) {
    if (e instanceof AiUnavailableError) throw new ApiError(503, "ai_unavailable", e.message);
    throw e;
  }
});
