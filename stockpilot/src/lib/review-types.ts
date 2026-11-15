/** Review item shapes shared by server routes and client components. */
import type { MatchTier } from "@/lib/domain/matching";
import type { MemberRole, MovementType } from "@/lib/domain/types";

export interface ReviewItemView {
  id: string;
  actionIndex: number;
  status: "pending" | "needs_clarification";
  spokenProduct: string;
  evidence: string;
  matchedProductId: string | null;
  matchedProductName: string | null;
  candidates: { productId: string; name: string; score: number; reasons: string[]; unit?: string | null; currentQuantity?: number | null }[];
  matchTier: MatchTier;
  movementType: MovementType | null;
  inputQuantity: number | null;
  inputUnit: string | null;
  baseQuantity: number | null;
  baseUnit: string | null;
  currentQuantity: number | null;
  quantityKind: "confirmed" | "visible" | "estimated";
  expiryDate: string | null;
  batchNumber: string | null;
  batchId: string | null;
  warnings: string[];
  riskLevel: "low" | "medium" | "high";
  requiresRole: MemberRole;
  clarificationQuestion: string | null;
  aiConfidence: number;
  matchConfidence: number | null;
}

export interface ExtractionOutcome {
  extractionId: string;
  valid: boolean;
  provider: string;
  error: string | null;
  overallConfidence: number | null;
  questions: string[];
  items: ReviewItemView[];
  notes: string[];
}

