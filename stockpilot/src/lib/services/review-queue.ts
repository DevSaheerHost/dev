import "server-only";
import type { AppContext } from "@/lib/auth/session";
import type { ReviewItemView } from "@/lib/review-types";

interface Row {
  id: string;
  action_index: number;
  status: "pending" | "needs_clarification";
  spoken_product: string | null;
  proposed: { evidence?: string } | null;
  matched_product_id: string | null;
  match_confidence: number | null;
  match_candidates: ReviewItemView["candidates"];
  ai_confidence: number | null;
  movement_type: ReviewItemView["movementType"];
  input_quantity: number | null;
  input_unit: string | null;
  base_quantity: number | null;
  quantity_kind: ReviewItemView["quantityKind"];
  expiry_date: string | null;
  batch_number: string | null;
  warnings: string[];
  risk_level: ReviewItemView["riskLevel"];
  requires_role: ReviewItemView["requiresRole"];
  clarification_question: string | null;
  created_at: string;
  created_by: string;
  source_type: "voice" | "photo";
  products: { name: string; unit: string; current_quantity: number } | null;
  ai_extractions: { photo_audits: { image_path: string } | null } | null;
}

export interface QueueEntry {
  item: ReviewItemView;
  createdAt: string;
  createdBy: string;
  createdByName: string | null;
  source: "voice" | "photo";
  imagePath: string | null;
}

export async function loadOpenReviewItems(ctx: AppContext, limit = 100): Promise<QueueEntry[]> {
  const { data, error } = await ctx.supabase
    .from("ai_review_queue")
    .select(
      "id, action_index, status, spoken_product, proposed, matched_product_id, match_confidence, match_candidates, ai_confidence, movement_type, input_quantity, input_unit, base_quantity, quantity_kind, expiry_date, batch_number, warnings, risk_level, requires_role, clarification_question, created_at, created_by, source_type, products(name, unit, current_quantity), ai_extractions(photo_audits(image_path))",
    )
    .eq("business_id", ctx.business.id)
    .in("status", ["pending", "needs_clarification"])
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  const rows = (data ?? []) as unknown as Row[];

  const userIds = [...new Set(rows.map((r) => r.created_by))];
  const { data: profiles } = userIds.length
    ? await ctx.supabase.from("profiles").select("id, full_name, email").in("id", userIds)
    : { data: [] as { id: string; full_name: string | null; email: string | null }[] };
  const names = new Map((profiles ?? []).map((p) => [p.id, p.full_name || p.email]));

  return rows.map((r) => ({
    createdAt: r.created_at,
    createdBy: r.created_by,
    createdByName: names.get(r.created_by) ?? null,
    source: r.source_type,
    imagePath: r.ai_extractions?.photo_audits?.image_path ?? null,
    item: {
      id: r.id,
      actionIndex: r.action_index,
      status: r.status,
      spokenProduct: r.spoken_product ?? "Unknown product",
      evidence: r.proposed?.evidence ?? "",
      matchedProductId: r.matched_product_id,
      matchedProductName: r.products?.name ?? null,
      candidates: r.match_candidates ?? [],
      matchTier: (r.match_confidence ?? 0) >= 0.95 ? "strong" : (r.match_confidence ?? 0) >= 0.8 ? "suggest" : "select",
      movementType: r.movement_type,
      inputQuantity: r.input_quantity === null ? null : Number(r.input_quantity),
      inputUnit: r.input_unit,
      baseQuantity: r.base_quantity === null ? null : Number(r.base_quantity),
      baseUnit: r.products?.unit ?? null,
      currentQuantity: r.products ? Number(r.products.current_quantity) : null,
      quantityKind: r.quantity_kind,
      expiryDate: r.expiry_date,
      batchNumber: r.batch_number,
      batchId: null,
      warnings: r.warnings ?? [],
      riskLevel: r.risk_level,
      requiresRole: r.requires_role,
      clarificationQuestion: r.clarification_question,
      aiConfidence: Number(r.ai_confidence ?? 0),
      matchConfidence: r.match_confidence === null ? null : Number(r.match_confidence),
    },
  }));
}
