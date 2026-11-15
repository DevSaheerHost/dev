import "server-only";
import type { AppContext } from "@/lib/auth/session";
import { PROMPT_VERSION, type PhotoExtraction, type PhotoMode, type VoiceExtraction } from "@/lib/ai/schemas";
import type { ProviderResult } from "@/lib/ai/provider";
import { buildProposal, fromDetectedProduct, fromVoiceAction, type ProposalInput } from "@/lib/domain/proposals";
import type { MemberRole, MovementType } from "@/lib/domain/types";
import { AppError, forbidden, notFound } from "@/lib/errors";
import { db } from "@/lib/firebase/admin";
import { isDocId, newId } from "@/lib/firebase/ids";
import type { ExtractionOutcome, ReviewItemView } from "@/lib/review-types";
import { loadCatalog } from "./catalog";
import type { ReviewItemDoc } from "./model";
import { notify } from "./notify";
import { biz, nowIso } from "./refs";
import { afterMovement, applyMovementTx, type ApplyResult } from "./stock";

const RANK: Record<MemberRole, number> = { employee: 1, manager: 2, owner: 3 };
const OPEN = ["pending", "needs_clarification"] as const;

export function toView(id: string, r: ReviewItemDoc, productNames?: Map<string, { name: string; unit: string; quantity: number }>): ReviewItemView {
  const p = r.matchedProductId ? productNames?.get(r.matchedProductId) : undefined;
  const cand = r.matchCandidates.find((c) => c.productId === r.matchedProductId);
  return {
    id, actionIndex: r.actionIndex, status: r.status === "needs_clarification" ? "needs_clarification" : "pending",
    spokenProduct: r.spokenProduct, evidence: r.evidence, matchedProductId: r.matchedProductId,
    matchedProductName: p?.name ?? cand?.name ?? null, candidates: r.matchCandidates,
    matchTier: (r.matchConfidence ?? 0) >= 0.95 ? "strong" : (r.matchConfidence ?? 0) >= 0.8 ? "suggest" : "select",
    movementType: r.movementType, inputQuantity: r.inputQuantity, inputUnit: r.inputUnit, baseQuantity: r.baseQuantity,
    baseUnit: p?.unit ?? cand?.unit ?? null, currentQuantity: p?.quantity ?? cand?.currentQuantity ?? null,
    quantityKind: r.quantityKind, expiryDate: r.expiryDate, batchNumber: r.batchNumber, batchId: r.batchId, warnings: r.warnings,
    riskLevel: r.riskLevel, requiresRole: r.requiresRole, clarificationQuestion: r.clarificationQuestion, aiConfidence: r.aiConfidence,
    matchConfidence: r.matchConfidence,
  };
}

async function persist(
  ctx: AppContext,
  source: { type: "voice"; voiceSessionId: string } | { type: "photo"; photoAuditId: string; imagePath: string },
  run: ProviderResult<VoiceExtraction | PhotoExtraction>,
  inputs: ProposalInput[],
  questions: string[],
  notes: string[],
): Promise<ExtractionOutcome> {
  const ref = biz(ctx.business.id);
  const catalog = inputs.length ? await loadCatalog(ctx.business.id) : [];
  const proposals = inputs.map((input, i) => buildProposal(input, i, catalog, ctx.business, ctx.role));
  let raw: unknown = null;
  try {
    raw = run.rawText ? JSON.parse(run.rawText) : null;
  } catch {
    raw = { unparseableText: run.rawText?.slice(0, 4000) };
  }
  const extractionId = newId();
  const now = nowIso();
  await ref.aiExtractions.doc(extractionId).create({
    sourceType: source.type, voiceSessionId: source.type === "voice" ? source.voiceSessionId : null,
    photoAuditId: source.type === "photo" ? source.photoAuditId : null, provider: run.provider, model: run.model, promptVersion: PROMPT_VERSION,
    rawOutput: raw, validatedOutput: run.result.ok ? run.result.data : null, isValid: run.result.ok,
    validationError: run.result.ok ? null : run.result.error.slice(0, 2000), overallConfidence: run.result.ok ? run.result.data.overall_confidence : null,
    clarificationQuestions: questions, latencyMs: run.latencyMs, createdBy: ctx.userId, createdAt: now,
  });
  if (!run.result.ok) {
    return { extractionId, valid: false, provider: run.provider, error: "The AI response could not be validated, so nothing was proposed. Please try again or rephrase.", overallConfidence: null, questions: [], items: [], notes };
  }

  const byId = new Map(catalog.map((p) => [p.id, { name: p.name, unit: p.unit as string, quantity: p.currentQuantity }]));
  const batch = db().batch();
  const items: ReviewItemView[] = [];
  let needsManager = false;
  for (const p of proposals) {
    const id = newId();
    const doc: ReviewItemDoc = {
      extractionId, sourceType: source.type, voiceSessionId: source.type === "voice" ? source.voiceSessionId : null,
      photoAuditId: source.type === "photo" ? source.photoAuditId : null, imagePath: source.type === "photo" ? source.imagePath : null,
      actionIndex: p.actionIndex, proposed: p.input as unknown as Record<string, unknown>, spokenProduct: p.input.productName.slice(0, 300),
      evidence: p.input.evidence.slice(0, 500), matchedProductId: p.matchedProductId, matchConfidence: p.match.best?.score ?? null,
      matchCandidates: p.match.candidates.map((c) => ({ ...c, unit: byId.get(c.productId)?.unit ?? null, currentQuantity: byId.get(c.productId)?.quantity ?? null })),
      aiConfidence: p.input.confidence, movementType: p.movementType, inputQuantity: p.inputQuantity, inputUnit: p.inputUnit?.slice(0, 32) ?? null,
      baseQuantity: p.baseQuantity, quantityKind: p.quantityKind, expiryDate: p.expiryDate, batchNumber: p.batchNumber, batchId: p.batchId,
      warnings: p.warnings, riskLevel: p.riskLevel, requiresRole: p.requiresRole, status: p.status, clarificationQuestion: p.clarificationQuestion?.slice(0, 500) ?? null,
      wasEdited: false, reviewerId: null, reviewedAt: null, reviewNote: null, appliedMovementId: null,
      createdBy: ctx.userId, createdByName: ctx.fullName ?? ctx.email, createdAt: now,
    };
    if (p.requiresRole !== "employee") needsManager = true;
    batch.create(ref.reviewItems.doc(id), doc);
    items.push(toView(id, doc, byId));
  }
  await batch.commit();
  if (needsManager) {
    await notify(ctx.business.id, { type: "ai_review", severity: "info", title: "AI changes need approval", body: "Large changes from an audit are waiting for a manager.", link: "/review", dedupeKey: `ai_review:${extractionId}` });
  }
  return { extractionId, valid: true, provider: run.provider, error: null, overallConfidence: run.result.data.overall_confidence, questions, items, notes };
}

export function persistVoiceExtraction(ctx: AppContext, voiceSessionId: string, run: ProviderResult<VoiceExtraction>) {
  const data = run.result.ok ? run.result.data : null;
  return persist(ctx, { type: "voice", voiceSessionId }, run, data?.actions.map(fromVoiceAction) ?? [], data?.clarification_questions ?? [], []);
}

export function persistPhotoExtraction(ctx: AppContext, photoAuditId: string, imagePath: string, mode: PhotoMode, run: ProviderResult<PhotoExtraction>) {
  const data = run.result.ok ? run.result.data : null;
  const notes = [...(data?.warnings ?? [])];
  if (data?.image_kind === "unrelated") notes.unshift("This photo doesn't look like store inventory.");
  if (data?.image_kind === "unreadable") notes.unshift("The photo is too blurry or dark to read. Try again with more light.");
  if (mode === "shelf") notes.push("Shelf photos count visible items only. Hidden stock is never assumed.");
  return persist(ctx, { type: "photo", photoAuditId, imagePath }, run, data?.detected_products.map((d) => fromDetectedProduct(d, mode)) ?? [], [], notes);
}

export async function listOpenReviewItems(ctx: AppContext) {
  const ref = biz(ctx.business.id);
  let q = ref.reviewItems.where("status", "in", [...OPEN]) as FirebaseFirestore.Query<ReviewItemDoc>;
  // Employees only see their own suggestions.
  if (ctx.role === "employee") q = q.where("createdBy", "==", ctx.userId);
  const snap = await q.limit(200).get();
  const docs = snap.docs.sort((a, b) => b.data().createdAt.localeCompare(a.data().createdAt)).slice(0, 100);
  const ids = [...new Set(docs.map((d) => d.data().matchedProductId).filter((x): x is string => !!x))];
  const products = ids.length ? await db().getAll(...ids.map((id) => ref.products.doc(id))) : [];
  const byId = new Map(products.filter((p) => p.exists).map((p) => [p.id, { name: p.data()!.name, unit: p.data()!.unit as string, quantity: p.data()!.quantity }]));
  return docs.map((d) => ({ item: toView(d.id, d.data(), byId), createdAt: d.data().createdAt, createdByName: d.data().createdByName, imagePath: d.data().imagePath }));
}

export async function countOpenReviews(ctx: AppContext): Promise<number> {
  let q = biz(ctx.business.id).reviewItems.where("status", "in", [...OPEN]) as FirebaseFirestore.Query<ReviewItemDoc>;
  if (ctx.role === "employee") q = q.where("createdBy", "==", ctx.userId);
  return (await q.count().get()).data().count;
}

export interface ApplyItemInput {
  id: string;
  productId: string;
  movementType: Exclude<MovementType, "initial" | "transfer">;
  baseQuantity: number;
  inputQuantity?: number | null;
  inputUnit?: string | null;
  batchId?: string | null;
  batchNumber?: string | null;
  expiryDate?: string | null;
  observedAt?: string | null;
}

/** Apply a confirmed (optionally edited) suggestion: stock change + item status in one transaction. */
export async function applyReviewItem(ctx: AppContext, input: ApplyItemInput): Promise<ApplyResult> {
  if (!isDocId(input.id) || !isDocId(input.productId)) throw notFound("Suggestion");
  const ref = biz(ctx.business.id);
  const itemRef = ref.reviewItems.doc(input.id);
  const result = await db().runTransaction(async (tx) => {
    const item = (await tx.get(itemRef)).data();
    if (!item) throw notFound("Suggestion");
    if (item.status === "applied" && item.appliedMovementId) {
      const m = (await tx.get(ref.movements.doc(item.appliedMovementId))).data();
      if (m) return { movement: { ...m, id: item.appliedMovementId }, duplicate: true, alerts: [], reorderThreshold: 0 } satisfies ApplyResult;
    }
    if (!(OPEN as readonly string[]).includes(item.status)) throw new AppError(409, "review_item_closed", "This suggestion was already handled.");
    if (RANK[ctx.role] < RANK[item.requiresRole]) throw new AppError(403, "approval_required", `A ${item.requiresRole} must approve this change.`);
    if (ctx.role === "employee" && item.createdBy !== ctx.userId) throw forbidden("Employees may only confirm their own audits.");

    const approver = ctx.role !== "employee" ? { userId: ctx.userId, name: ctx.fullName ?? ctx.email } : null;
    const applied = await applyMovementTx(tx, ctx.business.id, ctx.business, { userId: ctx.userId, name: ctx.fullName ?? ctx.email, role: ctx.role }, {
      productId: input.productId, type: input.movementType, quantity: input.baseQuantity, source: item.sourceType,
      idempotencyKey: `review:${input.id}`, reason: `AI ${item.sourceType} audit`, batchId: input.batchId ?? null,
      batchNumber: input.batchNumber ?? null, expiryDate: input.expiryDate ?? item.expiryDate, inputQuantity: input.inputQuantity ?? null,
      inputUnit: input.inputUnit ?? null, aiConfidence: item.aiConfidence, reviewItemId: input.id, approvedBy: approver,
      observedAt: input.observedAt ?? null,
    });
    tx.update(itemRef, {
      status: "applied",
      wasEdited: input.productId !== item.matchedProductId || input.movementType !== item.movementType || input.baseQuantity !== item.baseQuantity,
      reviewerId: ctx.userId, reviewedAt: nowIso(), appliedMovementId: applied.movement.id,
      matchedProductId: input.productId, movementType: input.movementType, baseQuantity: input.baseQuantity,
    });
    return applied;
  });
  if (!result.duplicate) await afterMovement(ctx.business.id, result);
  return result;
}

export async function rejectReviewItem(ctx: AppContext, id: string, note: string | null, superseded = false) {
  if (!isDocId(id)) throw notFound("Suggestion");
  const itemRef = biz(ctx.business.id).reviewItems.doc(id);
  await db().runTransaction(async (tx) => {
    const item = (await tx.get(itemRef)).data();
    if (!item) throw notFound("Suggestion");
    if (item.createdBy !== ctx.userId && RANK[ctx.role] < RANK.manager) throw forbidden();
    if (!(OPEN as readonly string[]).includes(item.status)) throw new AppError(409, "review_item_closed", "This suggestion was already handled.");
    tx.update(itemRef, { status: superseded ? "superseded" : "rejected", reviewerId: ctx.userId, reviewedAt: nowIso(), reviewNote: note?.slice(0, 500) ?? null });
  });
}

/** Route an employee's too-large change to managers instead of dropping it. */
export async function escalateReviewItem(ctx: AppContext, id: string): Promise<boolean> {
  const itemRef = biz(ctx.business.id).reviewItems.doc(id);
  const item = (await itemRef.get()).data();
  if (!item || item.createdBy !== ctx.userId || !(OPEN as readonly string[]).includes(item.status)) return false;
  await itemRef.update({ requiresRole: "manager", riskLevel: "high" });
  await notify(ctx.business.id, { type: "ai_review", severity: "info", title: "AI change needs approval", body: `${item.spokenProduct} — review before it is applied.`, link: "/review", dedupeKey: `ai_review:${id}` });
  return true;
}

export async function getReviewItem(ctx: AppContext, id: string) {
  if (!isDocId(id)) return null;
  const item = (await biz(ctx.business.id).reviewItems.doc(id).get()).data();
  if (!item || (ctx.role === "employee" && item.createdBy !== ctx.userId)) return null;
  return item;
}
