import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, authedRoute } from "@/lib/api/handler";
import { AiUnavailableError, getAiProvider } from "@/lib/ai/provider";
import { PHOTO_MODES } from "@/lib/ai/schemas";
import { biz, nowIso } from "@/lib/data/refs";
import { persistPhotoExtraction } from "@/lib/data/review";
import { signedUrl, uploadPrivate } from "@/lib/data/storage";
import { todayIso } from "@/lib/domain/expiry";
import { hashId, newId } from "@/lib/firebase/ids";
import { EXTENSION, readValidatedUpload, type ImageMime } from "@/lib/security/upload";

export const maxDuration = 60;
const fields = z.object({ mode: z.enum(PHOTO_MODES), clientDraftId: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/) });

/** Stores the photo privately, analyzes it and queues proposals for review. */
export const POST = authedRoute({ rateLimit: { name: "ai-photo", limit: 40, windowSeconds: 600 } }, async (request, ctx) => {
  const provider = getAiProvider();
  if (!provider.supportsVision) throw new ApiError(501, "vision_unavailable", "Photo recognition isn't configured yet. Ask the owner to add a Gemini API key.");
  const form = await request.formData();
  const parsed = fields.safeParse({ mode: form.get("mode"), clientDraftId: form.get("clientDraftId") });
  if (!parsed.success) throw new ApiError(400, "invalid_input", "Choose what the photo shows.");
  const upload = await readValidatedUpload<ImageMime>(form.get("image") as File | null, "image");
  if (!upload.ok) throw new ApiError(upload.status, "invalid_upload", upload.error);

  const auditRef = biz(ctx.business.id).photoAudits.doc(hashId(ctx.userId, parsed.data.clientDraftId));
  const path = `${ctx.business.id}/photo-audits/${ctx.userId}/${newId()}.${EXTENSION[upload.mime]}`;
  try {
    await auditRef.create({
      userId: ctx.userId, mode: parsed.data.mode, imagePath: path, mimeType: upload.mime, sizeBytes: upload.bytes.byteLength,
      sha256: createHash("sha256").update(upload.bytes).digest("hex"), status: "uploaded", createdAt: nowIso(),
    });
  } catch (e) {
    if ((e as { code?: number }).code === 6) return NextResponse.json({ duplicate: true, photoAuditId: auditRef.id });
    throw e;
  }
  try {
    await uploadPrivate(path, upload.bytes, upload.mime);
  } catch {
    await auditRef.update({ status: "failed" });
    throw new ApiError(502, "upload_failed", "Couldn't store the photo. Please try again.");
  }

  try {
    const run = await provider.analyzePhoto(upload.bytes, upload.mime, parsed.data.mode, todayIso(new Date(), ctx.business.timezone));
    const outcome = await persistPhotoExtraction(ctx, auditRef.id, path, parsed.data.mode, run);
    await auditRef.update({ status: outcome.valid ? "analyzed" : "failed" });
    return NextResponse.json({ photoAuditId: auditRef.id, imageUrl: await signedUrl(ctx.business.id, path), ...outcome });
  } catch (e) {
    await auditRef.update({ status: "failed" });
    if (e instanceof AiUnavailableError) throw new ApiError(503, "ai_unavailable", e.message);
    throw e;
  }
});
