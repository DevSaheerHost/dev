/**
 * Product matching: turn a casual description ("that blue allergy medicine")
 * into ranked catalog candidates with a calibrated confidence.
 *
 * Tiers (spec):
 *   >= 0.95  strong   — still shown for confirmation, never applied silently
 *   0.80–0.95 suggest — show candidate matches
 *   < 0.80   select   — ask the employee to pick a product
 * A near-tie between the top two candidates is never "strong".
 */

export interface MatchableProduct {
  id: string;
  name: string;
  sku?: string | null;
  barcode?: string | null;
  brand?: string | null;
  category?: string | null;
  description?: string | null;
  color?: string | null;
  packageSize?: string | null;
  synonyms?: string[] | null;
}

export type MatchTier = "strong" | "suggest" | "select";

export interface MatchCandidate {
  productId: string;
  name: string;
  score: number;
  reasons: string[];
}

export interface MatchResult {
  tier: MatchTier;
  best: MatchCandidate | null;
  candidates: MatchCandidate[];
}

export const STRONG_MATCH = 0.95;
export const SUGGEST_MATCH = 0.8;
const TIE_MARGIN = 0.05;

const STOPWORDS = new Set([
  "the", "a", "an", "that", "this", "those", "these", "some", "of", "for", "our", "my", "we", "with",
  "and", "kind", "type", "one", "ones", "stuff", "thing", "things", "brand", "product", "products",
  "box", "boxes", "pack", "packs", "case", "cases", "bottle", "bottles", "piece", "pieces", "unit", "units",
  "gallon", "gallons", "liter", "liters", "litre", "litres", "packet", "packets", "carton", "cartons",
]);

const COLORS = new Set([
  "red", "blue", "green", "yellow", "orange", "purple", "pink", "white", "black", "brown", "grey", "gray",
  "silver", "gold", "clear", "teal",
]);

/** Simple category vocabulary so "allergy medicine" can find "antihistamine". */
const CONCEPTS: Record<string, string[]> = {
  allergy: ["allergy", "antihistamine", "cetirizine", "loratadine", "fexofenadine", "hayfever", "hay"],
  pain: ["pain", "analgesic", "ibuprofen", "paracetamol", "acetaminophen", "aspirin", "naproxen"],
  cough: ["cough", "syrup", "expectorant", "dextromethorphan", "guaifenesin"],
  battery: ["battery", "batteries", "aa", "aaa", "alkaline", "lithium"],
  milk: ["milk", "dairy", "whole", "skim", "semi"],
  medicine: ["medicine", "medication", "tablet", "tablets", "capsule", "capsules", "pill", "pills", "mg"],
};

export function normalizeText(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/['’]s\b/g, "")
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9.\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function singular(token: string): string {
  if (token.length > 4 && token.endsWith("ies")) return `${token.slice(0, -3)}y`;
  if (token.length > 4 && /(ches|shes|xes|sses)$/.test(token)) return token.slice(0, -2);
  if (token.length > 3 && token.endsWith("s") && !token.endsWith("ss")) return token.slice(0, -1);
  return token;
}

export function tokenize(input: string): string[] {
  return normalizeText(input)
    .split(" ")
    .filter(Boolean)
    .map(singular);
}

function contentTokens(input: string): string[] {
  return tokenize(input).filter((t) => !STOPWORDS.has(t));
}

function bigrams(s: string): Map<string, number> {
  const out = new Map<string, number>();
  const text = ` ${s} `;
  for (let i = 0; i < text.length - 1; i++) {
    const g = text.slice(i, i + 2);
    out.set(g, (out.get(g) ?? 0) + 1);
  }
  return out;
}

/** Sørensen–Dice coefficient over character bigrams (0..1). */
export function diceSimilarity(a: string, b: string): number {
  const x = normalizeText(a);
  const y = normalizeText(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  const A = bigrams(x);
  const B = bigrams(y);
  let overlap = 0;
  for (const [g, n] of A) overlap += Math.min(n, B.get(g) ?? 0);
  const total = [...A.values()].reduce((s, n) => s + n, 0) + [...B.values()].reduce((s, n) => s + n, 0);
  return (2 * overlap) / total;
}

/** Specific medicine kinds imply the general "medicine" concept. */
const IMPLIES: Record<string, string[]> = { allergy: ["medicine"], pain: ["medicine"], cough: ["medicine"] };

function conceptsOf(tokens: string[]): Set<string> {
  const out = new Set<string>();
  for (const [concept, words] of Object.entries(CONCEPTS)) {
    if (tokens.some((t) => words.includes(t))) {
      out.add(concept);
      for (const implied of IMPLIES[concept] ?? []) out.add(implied);
    }
  }
  return out;
}

/** Fraction of query tokens found (fuzzily) in the product's tokens. */
function tokenCoverage(queryTokens: string[], productTokens: string[]): number {
  if (queryTokens.length === 0) return 0;
  let hit = 0;
  for (const q of queryTokens) {
    let best = 0;
    for (const p of productTokens) {
      if (p === q) {
        best = 1;
        break;
      }
      if (q.length >= 4 && p.length >= 4 && (p.startsWith(q) || q.startsWith(p))) best = Math.max(best, 0.85);
      else best = Math.max(best, diceSimilarity(q, p) >= 0.75 ? 0.7 : 0);
    }
    hit += best;
  }
  return hit / queryTokens.length;
}

const STRENGTH = /\b(\d+(?:\.\d+)?)\s?(mg|mcg|g|kg|ml|l|oz|lb|v|mah)\b/g;
function strengths(text: string): Set<string> {
  const out = new Set<string>();
  for (const m of normalizeText(text).matchAll(STRENGTH)) out.add(`${Number(m[1])}${m[2]}`);
  return out;
}

export function scoreProduct(query: string, product: MatchableProduct): MatchCandidate {
  const reasons: string[] = [];
  const q = query.trim();
  const nq = normalizeText(q);

  // Exact identifiers win outright.
  if (product.barcode && q.replace(/\s/g, "") === product.barcode) {
    return { productId: product.id, name: product.name, score: 1, reasons: ["Barcode match"] };
  }
  if (product.sku && nq === normalizeText(product.sku)) {
    return { productId: product.id, name: product.name, score: 1, reasons: ["SKU match"] };
  }

  const nameScore = diceSimilarity(nq, product.name);
  const synonymScore = Math.max(0, ...(product.synonyms ?? []).map((s) => diceSimilarity(nq, s)));
  if (synonymScore > nameScore && synonymScore > 0.6) reasons.push("Matches a known synonym");

  const qTokens = contentTokens(q);
  const haystack = [product.name, product.brand, product.category, product.description, product.color,
    product.packageSize, ...(product.synonyms ?? [])].filter(Boolean).join(" ");
  const pTokens = tokenize(haystack);
  const coverage = tokenCoverage(qTokens, pTokens);
  if (coverage >= 0.99) reasons.push("All described words found");

  let score = Math.max(nameScore, synonymScore) * 0.6 + coverage * 0.4;
  // Every described word appears in the product's own name ("milk" → "Whole Milk").
  if (qTokens.length > 0 && tokenCoverage(qTokens, tokenize(product.name)) >= 0.99) {
    score = Math.max(score, 0.82 + 0.03 * Math.min(qTokens.length - 1, 3));
  }
  // A near-verbatim name is a strong signal on its own.
  if (Math.max(nameScore, synonymScore) >= 0.97) score = Math.max(score, 0.97);

  // Semantic hints
  const qConcepts = conceptsOf(qTokens);
  const pConcepts = conceptsOf(pTokens);
  const sharedConcepts = [...qConcepts].filter((c) => pConcepts.has(c));
  if (sharedConcepts.length > 0) {
    score += 0.12 * sharedConcepts.length;
    reasons.push(`Same kind of product (${sharedConcepts.join(", ")})`);
  }
  if (pConcepts.size > 0) {
    // The product is a known kind of thing, but not the kind that was asked for.
    const missing = [...qConcepts].filter((c) => !pConcepts.has(c)).length;
    score -= 0.08 * missing;
  }

  const qColors = qTokens.filter((t) => COLORS.has(t));
  if (qColors.length > 0) {
    const productColors = new Set(tokenize(`${product.color ?? ""} ${product.name} ${product.description ?? ""}`));
    if (qColors.some((c) => productColors.has(c))) {
      score += 0.1;
      reasons.push(`Colour matches (${qColors.join(", ")})`);
    } else {
      score -= 0.05;
    }
  }

  if (product.brand && qTokens.some((t) => tokenize(product.brand ?? "").includes(t))) {
    score += 0.05;
    reasons.push("Brand matches");
  }

  // Conflicting strengths (10mg vs 120mg) are a strong negative signal.
  const qs = strengths(q);
  if (qs.size > 0) {
    const ps = strengths(haystack);
    if ([...qs].some((s) => ps.has(s))) {
      score += 0.08;
      reasons.push("Strength/size matches");
    } else if (ps.size > 0) {
      score -= 0.25;
      reasons.push("Strength/size differs");
    }
  }

  return { productId: product.id, name: product.name, score: Math.max(0, Math.min(1, round(score))), reasons };
}

const round = (n: number) => Math.round(n * 1000) / 1000;

export function classifyMatch(candidates: MatchCandidate[]): MatchTier {
  const [first, second] = candidates;
  if (!first) return "select";
  const tied = second !== undefined && first.score - second.score < TIE_MARGIN;
  // Two equally likely products: make the person choose rather than pre-select one.
  if (tied) return "select";
  if (first.score >= STRONG_MATCH) return "strong";
  if (first.score >= SUGGEST_MATCH) return "suggest";
  return "select";
}

export function matchProduct(query: string, products: MatchableProduct[], limit = 5): MatchResult {
  if (!query.trim() || products.length === 0) return { tier: "select", best: null, candidates: [] };
  const ranked = products
    .map((p) => scoreProduct(query, p))
    .filter((c) => c.score > 0.2)
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .slice(0, limit);
  const tier = classifyMatch(ranked);
  return { tier, best: ranked[0] ?? null, candidates: ranked };
}
