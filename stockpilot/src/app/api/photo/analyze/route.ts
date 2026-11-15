import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, authedRoute, fromDbError } from "@/lib/api/handler";
import { AiUnavailableError, getAiProvider } from "@/lib/ai/provider";
import { PHOTO_MODES } from "@/lib/ai/schemas";
import { businessToday, persistPhotoExtraction } from "@/lib/services/extraction";
import { EXTENSION, readValidatedUpload, type ImageMime } from "@/lib/security/upload";

export const maxDuration = 60;

const fields = z.object({
  mode: z.enum(PHOTO_MODES),
  clientDraftId: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/),
});

/** Uploads a photo to private storage, analyzes it and queues proposals for review. */
export const POST = authedRoute({ rateLimit: { name: "ai-photo", limit: 40, windowSeconds: 600 } }, async (request, ctx) => {
  const provider = getAiProvider();
  if (!provider.supportsVision) {
    throw new ApiError(501, "vision_unavailable", "Photo recognition isn't configured yet. Ask the owner to add a Gemini API key.");
  }
  const form = await request.formData();
  const parsed = fields.safeParse({ mode: form.get("mode"), clientDraftId: form.get("clientDraftId") });
  if (!parsed.success) throw new ApiError(400, "invalid_input", "Choose what the photo shows.");
  const upload = await readValidatedUpload<ImageMime>(form.get("image") as File | null, "image");
  if (!upload.ok) throw new ApiError(upload.status, "invalid_upload", upload.error);

  const { data: existing } = await ctx.supabase
    .from("photo_audits")
    .select("id")
    .eq("business_id", ctx.business.id)
    .eq("client_draft_id", parsed.data.clientDraftId)
    .maybeSingle();
  if (existing) return NextResponse.json({ duplicate: true, photoAuditId: existing.id });

  const path = `${ctx.business.id}/photo-audits/${ctx.userId}/${crypto.randomUUID()}.${EXTENSION[upload.mime]}`;
  const { error: storageError } = await ctx.supabase.storage
    .from("inventory-media")
    .upload(path, upload.bytes, { contentType: upload.mime, upsert: false });
  if (storageError) throw new ApiError(502, "upload_failed", "Couldn't store the photo. Please try again.");

  const { data: audit, error } = await ctx.supabase
    .from("photo_audits")
    .insert({
      business_id: ctx.business.id,
      user_id: ctx.userId,
      mode: parsed.data.mode,
      image_path: path,
      mime_type: upload.mime,
      size_bytes: upload.bytes.byteLength,
      sha256: createHash("sha256").update(upload.bytes).digest("hex"),
      client_draft_id: parsed.data.clientDraftId,
    })
    .select("id")
    .single();
  if (error || !audit) throw fromDbError(error);

  try {
    const run = await provider.analyzePhoto(upload.bytes, upload.mime, parsed.data.mode, businessToday(ctx));
    const outcome = await persistPhotoExtraction(ctx, audit.id, parsed.data.mode, run);
    await ctx.supabase.from("photo_audits").update({ status: outcome.valid ? "analyzed" : "failed" }).eq("id", audit.id);
    const { data: signed } = await ctx.supabase.storage.from("inventory-media").createSignedUrl(path, 600);
    return NextResponse.json({ photoAuditId: audit.id, imageUrl: signed?.signedUrl ?? null, ...outcome });
  } catch (e) {
    await ctx.supabase.from("photo_audits").update({ status: "failed" }).eq("id", audit.id);
    if (e instanceof AiUnavailableError) throw new ApiError(503, "ai_unavailable", e.message);
    throw e;
  }
});
