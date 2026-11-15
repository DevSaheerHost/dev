import "server-only";
import type { AppContext } from "@/lib/auth/session";
import { PROMPT_VERSION, type PhotoExtraction, type PhotoMode, type VoiceExtraction } from "@/lib/ai/schemas";
import type { ProviderResult } from "@/lib/ai/provider";
import { todayIso } from "@/lib/domain/expiry";
import { buildProposal, fromDetectedProduct, fromVoiceAction, type Proposal, type ProposalInput } from "@/lib/domain/proposals";
import { ApiError, fromDbError } from "@/lib/api/handler";
import { loadCatalog } from "./catalog";
import type { ExtractionOutcome, ReviewItemView } from "@/lib/review-types";

export type { ExtractionOutcome, ReviewItemView };

export function businessToday(ctx: AppContext): string {
  return todayIso(new Date(), ctx.business.timezone);
}

async function persist(
  ctx: AppContext,
  source: { type: "voice"; voiceSessionId: string } | { type: "photo"; photoAuditId: string },
  run: ProviderResult<VoiceExtraction | PhotoExtraction>,
  inputs: ProposalInput[],
  questions: string[],
  notes: string[],
): Promise<ExtractionOutcome> {
  const catalog = inputs.length > 0 ? await loadCatalog(ctx) : [];
  const rules = { largeAdjustmentUnits: ctx.business.largeAdjustmentUnits, largeAdjustmentPercent: ctx.business.largeAdjustmentPercent };
  const proposals = inputs.map((input, i) => buildProposal(input, i, catalog, rules, ctx.role));

  const rawOutput = (() => {
    try {
      return run.rawText ? JSON.parse(run.rawText) : null;
    } catch {
      return { unparseable_text: run.rawText?.slice(0, 4000) };
    }
  })();

  const { data: extraction, error } = await ctx.supabase
    .from("ai_extractions")
    .insert({
      business_id: ctx.business.id,
      source_type: source.type,
      voice_session_id: source.type === "voice" ? source.voiceSessionId : null,
      photo_audit_id: source.type === "photo" ? source.photoAuditId : null,
      provider: run.provider,
      model: run.model,
      prompt_version: PROMPT_VERSION,
      raw_output: rawOutput,
      validated_output: run.result.ok ? run.result.data : null,
      is_valid: run.result.ok,
      validation_error: run.result.ok ? null : run.result.error.slice(0, 2000),
      overall_confidence: run.result.ok ? run.result.data.overall_confidence : null,
      clarification_questions: questions,
      latency_ms: run.latencyMs,
      created_by: ctx.userId,
    })
    .select("id")
    .single();
  if (error || !extraction) throw fromDbError(error);

  if (!run.result.ok) {
    return { extractionId: extraction.id, valid: false, provider: run.provider, error: "The AI response could not be validated, so nothing was proposed. Please try again or rephrase.", overallConfidence: null, questions: [], items: [], notes };
  }

  const byId = new Map(catalog.map((p) => [p.id, p]));
  let items: ReviewItemView[] = [];
  if (proposals.length > 0) {
    const rows = proposals.map((p) => ({
      business_id: ctx.business.id,
      extraction_id: extraction.id,
      source_type: source.type,
      action_index: p.actionIndex,
      proposed: p.input,
      spoken_product: p.input.productName.slice(0, 300),
      matched_product_id: p.matchedProductId,
      match_confidence: p.match.best?.score ?? null,
      match_candidates: p.match.candidates,
      ai_confidence: p.input.confidence,
      movement_type: p.movementType,
      input_quantity: p.inputQuantity,
      input_unit: p.inputUnit?.slice(0, 32) ?? null,
      base_quantity: p.baseQuantity,
      quantity_kind: p.quantityKind,
      expiry_date: p.expiryDate,
      batch_number: p.batchNumber,
      warnings: p.warnings,
      risk_level: p.riskLevel,
      requires_role: p.requiresRole,
      status: p.status,
      clarification_question: p.clarificationQuestion?.slice(0, 500) ?? null,
      created_by: ctx.userId,
    }));
    const { data: inserted, error: insertError } = await ctx.supabase.from("ai_review_queue").insert(rows).select("id, action_index");
    if (insertError || !inserted) throw fromDbError(insertError);
    const idByIndex = new Map(inserted.map((r) => [r.action_index as number, r.id as string]));

    items = proposals.map((p) => {
      const product = p.matchedProductId ? byId.get(p.matchedProductId) : (p.match.best ? byId.get(p.match.best.productId) : undefined);
      return {
        id: idByIndex.get(p.actionIndex)!,
        actionIndex: p.actionIndex,
        status: p.status,
        spokenProduct: p.input.productName,
        evidence: p.input.evidence,
        matchedProductId: p.matchedProductId,
        matchedProductName: p.matchedProductId ? byId.get(p.matchedProductId)?.name ?? null : null,
        candidates: p.match.candidates.map((c) => ({ ...c, unit: byId.get(c.productId)?.unit ?? null, currentQuantity: byId.get(c.productId)?.currentQuantity ?? null })),
        matchTier: p.match.tier,
        movementType: p.movementType,
        inputQuantity: p.inputQuantity,
        inputUnit: p.inputUnit,
        baseQuantity: p.baseQuantity,
        baseUnit: product?.unit ?? null,
        currentQuantity: product?.currentQuantity ?? null,
        quantityKind: p.quantityKind,
        expiryDate: p.expiryDate,
        batchNumber: p.batchNumber,
        batchId: p.batchId,
        warnings: p.warnings,
        riskLevel: p.riskLevel,
        requiresRole: p.requiresRole,
        clarificationQuestion: p.clarificationQuestion,
        aiConfidence: p.input.confidence,
        matchConfidence: p.match.best?.score ?? null,
      };
    });
  }

  return {
    extractionId: extraction.id,
    valid: true,
    provider: run.provider,
    error: null,
    overallConfidence: run.result.data.overall_confidence,
    questions,
    items,
    notes,
  };
}

export async function persistVoiceExtraction(ctx: AppContext, voiceSessionId: string, run: ProviderResult<VoiceExtraction>) {
  const data = run.result.ok ? run.result.data : null;
  const inputs = data?.actions.map(fromVoiceAction) ?? [];
  return persist(ctx, { type: "voice", voiceSessionId }, run, inputs, data?.clarification_questions ?? [], []);
}

export async function persistPhotoExtraction(ctx: AppContext, photoAuditId: string, mode: PhotoMode, run: ProviderResult<PhotoExtraction>) {
  const data = run.result.ok ? run.result.data : null;
  const notes = [...(data?.warnings ?? [])];
  if (data?.image_kind === "unrelated") notes.unshift("This photo doesn't look like store inventory.");
  if (data?.image_kind === "unreadable") notes.unshift("The photo is too blurry or dark to read. Try again with more light.");
  if (mode === "shelf") notes.push("Shelf photos count visible items only. Hidden stock is never assumed.");
  const inputs = data?.detected_products.map((d) => fromDetectedProduct(d, mode)) ?? [];
  return persist(ctx, { type: "photo", photoAuditId }, run, inputs, [], notes);
}

export function assertTranscript(text: string): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length < 2) throw new ApiError(400, "empty_transcript", "Say or type what changed first.");
  if (t.length > 5000) throw new ApiError(400, "too_long", "That's too long. Keep each update under 5000 characters.");
  return t;
}
