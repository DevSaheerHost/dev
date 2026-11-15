/**
 * Turns validated AI output into reviewable stock-change proposals.
 *
 * This is the policy layer between "what the model said" and "what may be
 * applied". It never applies anything; it decides what needs a human, which
 * human, and why.
 */
import type { DetectedProduct, PhotoMode, VoiceAction, VoiceActionOutput } from "@/lib/ai/schemas";
import { matchProduct, type MatchableProduct, type MatchResult } from "./matching";
import { convertToBase, normalizeUnit, UNIT_LABELS, type StockUnit, type VariantConversion } from "./units";
import type { MemberRole, MovementType } from "./types";

export interface CatalogBatch {
  id: string;
  batchNumber: string | null;
  expiryDate: string | null;
  quantity: number;
}

export interface CatalogProduct extends MatchableProduct {
  unit: StockUnit;
  currentQuantity: number;
  variants: VariantConversion[];
  batches?: CatalogBatch[];
}

export interface InventoryRules {
  largeAdjustmentUnits: number;
  largeAdjustmentPercent: number;
}

export type QuantityKind = "confirmed" | "visible" | "estimated";
export type RiskLevel = "low" | "medium" | "high";

export interface ProposalInput {
  productName: string;
  action: VoiceAction;
  quantity: number | null;
  unit: string | null;
  quantityKind: QuantityKind;
  expiryDate: string | null;
  expiryStatus: "expired" | "expiring" | null;
  batchNumber: string | null;
  toLocation: string | null;
  confidence: number;
  evidence: string;
  clarificationQuestion: string | null;
}

export interface Proposal {
  actionIndex: number;
  input: ProposalInput;
  match: MatchResult;
  matchedProductId: string | null;
  movementType: MovementType | null;
  inputQuantity: number | null;
  inputUnit: string | null;
  baseQuantity: number | null;
  quantityKind: QuantityKind;
  expiryDate: string | null;
  batchNumber: string | null;
  batchId: string | null;
  warnings: string[];
  riskLevel: RiskLevel;
  requiresRole: MemberRole;
  status: "pending" | "needs_clarification";
  clarificationQuestion: string | null;
  /** True when a human must pick/confirm the product before applying. */
  productNeedsSelection: boolean;
}

export const ACTION_TO_MOVEMENT: Record<VoiceAction, MovementType | null> = {
  set_stock: "set_count",
  receive_stock: "receive",
  sell_stock: "sale",
  report_damage: "damage",
  report_expiry: "expire",
  report_missing: "missing",
  transfer_stock: "transfer",
  correct_stock: "correction",
  unclear: null,
};

export const LOW_CONFIDENCE = 0.8;

const DEDUCTIONS: MovementType[] = ["sale", "damage", "expire", "missing"];

/** Signed change in base units a movement would cause. */
export function projectedChange(type: MovementType, baseQuantity: number, current: number): number {
  switch (type) {
    case "receive":
    case "return":
    case "initial":
    case "correction":
      return baseQuantity;
    case "sale":
    case "damage":
    case "expire":
    case "missing":
      return -baseQuantity;
    case "set_count":
      return baseQuantity - current;
    case "transfer":
      return 0;
  }
}

export function isLargeAdjustment(change: number, current: number, rules: InventoryRules): boolean {
  const pct = current > 0 ? (Math.abs(change) / current) * 100 : 0;
  return Math.abs(change) > rules.largeAdjustmentUnits || (current >= 10 && pct > rules.largeAdjustmentPercent);
}

export function fromVoiceAction(a: VoiceActionOutput): ProposalInput {
  return {
    productName: a.product_name,
    action: a.action,
    quantity: a.quantity,
    unit: a.unit,
    quantityKind: "confirmed",
    expiryDate: a.expiry_date,
    expiryStatus: a.expiry_status,
    batchNumber: a.batch_number,
    toLocation: a.to_location,
    confidence: a.confidence,
    evidence: a.evidence,
    clarificationQuestion: a.clarification_question,
  };
}

/**
 * Photo detections map to actions by capture mode. Shelf photos never become
 * stock counts on their own: they are observations of VISIBLE items only.
 */
export function fromDetectedProduct(d: DetectedProduct, mode: PhotoMode): ProposalInput {
  let action: VoiceAction = "unclear";
  let kind: QuantityKind = d.quantity_kind === "document" ? "confirmed" : d.quantity_kind;
  let question: string | null = null;

  if (mode === "packing_slip" || d.quantity_kind === "document") {
    action = "receive_stock";
    kind = "confirmed";
  } else if (mode === "damage" || d.condition === "damaged") {
    action = "report_damage";
  } else if (mode === "expiry_label" || d.condition === "expired") {
    action = d.condition === "expired" ? "report_expiry" : "unclear";
    if (action === "unclear") question = `Should the ${d.product_name} with this label be recorded as expired?`;
  } else {
    action = "unclear";
    question = `The photo shows ${d.quantity ?? "some"} visible ${d.product_name}. Is that the full stock, or is more stored elsewhere?`;
  }

  return {
    productName: d.brand && !d.product_name.toLowerCase().includes(d.brand.toLowerCase()) ? `${d.brand} ${d.product_name}` : d.product_name,
    action,
    quantity: d.quantity,
    unit: d.unit,
    quantityKind: kind,
    expiryDate: d.expiry_date,
    expiryStatus: d.condition === "expired" ? "expired" : null,
    batchNumber: d.batch_number,
    toLocation: null,
    confidence: d.confidence,
    evidence: d.notes,
    clarificationQuestion: question,
  };
}

export function buildProposal(
  input: ProposalInput,
  actionIndex: number,
  catalog: CatalogProduct[],
  rules: InventoryRules,
  actorRole: MemberRole,
): Proposal {
  const warnings: string[] = [];
  const questions: string[] = [];
  let risk: RiskLevel = "low";
  let requiresRole: MemberRole = "employee";
  const bump = (level: RiskLevel) => {
    const order: RiskLevel[] = ["low", "medium", "high"];
    if (order.indexOf(level) > order.indexOf(risk)) risk = level;
  };

  const match = matchProduct(input.productName, catalog);
  const productNeedsSelection = match.tier === "select";
  const matchedProductId = match.tier === "select" ? null : match.best?.productId ?? null;
  const product = catalog.find((p) => p.id === (match.best?.productId ?? ""));

  if (match.candidates.length === 0) {
    questions.push(`I couldn't find "${input.productName}" in your catalog. Which product is it, or should it be added first?`);
  } else if (match.tier === "select") {
    warnings.push(`Not sure which product "${input.productName}" is. Please pick the right one.`);
    bump("medium");
  } else if (match.tier === "suggest") {
    warnings.push(`Matched to "${match.best?.name}" with ${Math.round((match.best?.score ?? 0) * 100)}% confidence. Check it is the right product.`);
    bump("medium");
  }
  if (match.candidates.length > 1 && match.candidates[0].score - match.candidates[1].score < 0.05) {
    warnings.push(`"${match.candidates[0].name}" and "${match.candidates[1].name}" look equally likely.`);
  }

  let movementType = ACTION_TO_MOVEMENT[input.action];
  if (input.action === "report_expiry" && input.expiryStatus === "expiring") {
    movementType = null;
    warnings.push("Reported as expiring soon, not expired. Nothing will be removed from stock.");
  }
  if (input.clarificationQuestion && (input.action === "unclear" || input.quantity === null)) {
    questions.push(input.clarificationQuestion);
  } else if (input.action === "unclear") {
    questions.push(`What should happen to the ${input.productName}?`);
  }

  if (input.quantityKind !== "confirmed") {
    warnings.push(
      input.quantityKind === "visible"
        ? "Shelf photos only show visible items. Stock behind or elsewhere is not counted."
        : "This quantity is an estimate.",
    );
    if (movementType === "set_count") movementType = null; // never overwrite a count from a visible estimate
    bump("medium");
  }

  // Quantity & units
  let baseQuantity: number | null = null;
  const unit = normalizeUnit(input.unit);
  if (input.unit && !unit) warnings.push(`Unknown unit "${input.unit}".`);
  if (movementType && input.quantity === null) {
    questions.push(`How many ${input.productName}?`);
  } else if (input.quantity !== null && product) {
    const qty = movementType === "correction" ? Math.abs(input.quantity) : input.quantity;
    const conv = convertToBase(qty, unit, product);
    if (conv.ok) {
      baseQuantity = movementType === "correction" ? Math.sign(input.quantity) * conv.quantity : conv.quantity;
      if (conv.via !== "same" && conv.note) warnings.push(`Converted: ${conv.note}.`);
      if (conv.via === "physical" && unit) {
        warnings.push(`Converted ${input.quantity} ${UNIT_LABELS[unit].plural} to ${conv.quantity} ${UNIT_LABELS[product.unit].plural}.`);
      }
    } else {
      questions.push(conv.reason);
    }
  }

  // Batch resolution for expiries (FEFO when unspecified)
  let batchId: string | null = null;
  if (product && movementType === "expire" && product.batches?.length) {
    const exact = product.batches.find(
      (b) => (input.batchNumber && b.batchNumber === input.batchNumber) || (input.expiryDate && b.expiryDate === input.expiryDate),
    );
    if (exact) batchId = exact.id;
    else warnings.push("Batch not identified: the earliest-expiring batches will be reduced first (FEFO).");
  }
  if (movementType === "expire" && !input.expiryDate) {
    warnings.push("No expiry date was given; none will be assumed.");
  }

  // Risk
  if (product && movementType && baseQuantity !== null) {
    const change = projectedChange(movementType, baseQuantity, product.currentQuantity);
    if (DEDUCTIONS.includes(movementType) && baseQuantity > product.currentQuantity) {
      questions.push(
        `Only ${product.currentQuantity} ${UNIT_LABELS[product.unit].plural} of ${product.name} are recorded. Remove ${baseQuantity}? Consider a stock count instead.`,
      );
    }
    if (isLargeAdjustment(change, product.currentQuantity, rules)) {
      warnings.push(`Large change: ${change > 0 ? "+" : ""}${change} ${UNIT_LABELS[product.unit].plural} (currently ${product.currentQuantity}).`);
      bump("high");
      if (actorRole === "employee") requiresRole = "manager";
    }
    if (["damage", "expire", "missing"].includes(movementType)) bump("medium");
  }
  if (movementType === "correction" || movementType === "transfer") {
    if (actorRole === "employee") requiresRole = "manager";
    bump("medium");
  }
  if (input.confidence < LOW_CONFIDENCE) {
    warnings.push(`Low AI confidence (${Math.round(input.confidence * 100)}%). Please double-check.`);
    bump("medium");
  }

  const clarificationQuestion = questions[0] ?? null;
  return {
    actionIndex,
    input,
    match,
    matchedProductId,
    movementType,
    inputQuantity: input.quantity,
    inputUnit: input.unit,
    baseQuantity,
    quantityKind: input.quantityKind,
    expiryDate: input.expiryDate,
    batchNumber: input.batchNumber,
    batchId,
    warnings: [...new Set(warnings)].slice(0, 10),
    riskLevel: risk,
    requiresRole,
    status: clarificationQuestion ? "needs_clarification" : "pending",
    clarificationQuestion,
    productNeedsSelection,
  };
}

/** Whether a proposal can be applied as-is (all required fields resolved). */
export function isApplicable(p: Pick<Proposal, "matchedProductId" | "movementType" | "baseQuantity" | "status">): boolean {
  return p.status === "pending" && p.matchedProductId !== null && p.movementType !== null && p.baseQuantity !== null;
}
