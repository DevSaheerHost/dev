import { NextResponse } from "next/server";
import { ApiError, authedRoute } from "@/lib/api/handler";
import { AiUnavailableError, getAiProvider } from "@/lib/ai/provider";
import { EXTENSION, readValidatedUpload, type AudioMime } from "@/lib/security/upload";

export const maxDuration = 60;

/** Server-side transcription of a recorded clip (used when live browser speech recognition is unavailable). */
export const POST = authedRoute({ rateLimit: { name: "ai-transcribe", limit: 30, windowSeconds: 600 } }, async (request, ctx) => {
  const provider = getAiProvider();
  if (!provider.supportsTranscription) {
    throw new ApiError(501, "transcription_unavailable", "Server transcription isn't configured. Use live transcription or type the update.");
  }
  const form = await request.formData();
  const upload = await readValidatedUpload<AudioMime>(form.get("audio") as File | null, "audio");
  if (!upload.ok) throw new ApiError(upload.status, "invalid_upload", upload.error);

  const path = `${ctx.business.id}/voice/${ctx.userId}/${crypto.randomUUID()}.${EXTENSION[upload.mime]}`;
  const { error: storageError } = await ctx.supabase.storage
    .from("inventory-media")
    .upload(path, upload.bytes, { contentType: upload.mime, upsert: false });
  if (storageError) console.error("Audio upload failed", storageError.message);

  try {
    const run = await provider.transcribe(upload.bytes, upload.mime);
    if (!run.result.ok) throw new ApiError(502, "transcription_invalid", "Couldn't understand the recording. Please try again.");
    return NextResponse.json({ transcript: run.result.data.transcript, confidence: run.result.data.confidence, audioPath: storageError ? null : path });
  } catch (e) {
    if (e instanceof AiUnavailableError) throw new ApiError(503, "ai_unavailable", e.message);
    throw e;
  }
});
