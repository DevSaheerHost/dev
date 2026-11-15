/**
 * Deterministic, rule-based voice command parser.
 *
 * Used when no LLM provider is configured, and as a sanity baseline. It is
 * deliberately conservative: when the intent is not explicit it emits an
 * "unclear" action with a clarification question instead of guessing.
 */
import type { VoiceAction, VoiceActionOutput, VoiceExtraction } from "./schemas";

const SMALL: Record<string, number> = {
  zero: 0, no: 0, none: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17,
  eighteen: 18, nineteen: 19,
};
const TENS: Record<string, number> = {
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};
const UNIT_WORDS = new Set([
  "piece", "pieces", "pcs", "unit", "units", "item", "items", "box", "boxes", "carton", "cartons",
  "pack", "packs", "packet", "packets", "bottle", "bottles", "kg", "kilo", "kilos", "kilogram", "kilograms",
  "g", "gram", "grams", "l", "liter", "liters", "litre", "litres", "ml", "gallon", "gallons", "gal",
  "case", "cases", "crate", "crates",
]);

interface Intent {
  action: VoiceAction;
  pattern: RegExp;
}

// Order matters: the first matching intent wins.
const INTENTS: Intent[] = [
  { action: "transfer_stock", pattern: /\b(moved|move|transferred|transfer|shifted)\b.*\bto\b/ },
  { action: "report_expiry", pattern: /\b(expired|expiring|expires|expire|out of date|past (its |the )?(expiry|sell[- ]by|best[- ]before))\b/ },
  { action: "report_damage", pattern: /\b(damaged|broken|crushed|leaking|leaked|dented|smashed|torn|spoiled|spoilt)\b/ },
  { action: "report_missing", pattern: /\b(missing|stolen|lost|can'?t find|cannot find|disappeared)\b/ },
  { action: "sell_stock", pattern: /\b(sold|sell|sales of)\b/ },
  { action: "receive_stock", pattern: /\b(arrived|came in|come in|received|delivered|delivery|got in|restocked|new stock|just in)\b/ },
  { action: "correct_stock", pattern: /\b(off by|correction|correct (the )?count)\b/ },
  {
    action: "set_stock",
    pattern: /\b(left|remaining|remain|in stock|on the shelf|on hand|counted|down to|only|there (are|is)|we'?re at|count is)\b/,
  },
];

const FILLER = new Set([
  "we", "we've", "weve", "i", "you", "they", "have", "has", "had", "got", "get", "there", "are", "is", "was",
  "were", "be", "been", "left", "remaining", "remain", "of", "the", "a", "an", "some", "just", "only", "about",
  "around", "roughly", "today", "yesterday", "tomorrow", "this", "morning", "afternoon", "evening", "now", "new",
  "in", "on", "stock", "shelf", "hand", "arrived", "came", "come", "received", "delivered", "delivery", "restocked",
  "sold", "sell", "sales", "damaged", "broken", "crushed", "leaking", "leaked", "dented", "smashed", "torn",
  "spoiled", "spoilt", "missing", "stolen", "lost", "cant", "can't", "cannot", "find", "disappeared", "expired",
  "expiring", "expires", "expire", "out", "date", "past", "its", "expiry", "it", "counted", "down", "to", "at",
  "we're", "were", "count", "off", "by", "and", "also", "plus", "then", "please", "okay", "ok", "so", "um",
  "uh", "moved", "move", "transferred", "transfer", "shifted", "that", "these", "those", "our", "my", "all",
  "more", "another", "extra", "correction", "correct", "units", "unit", "items", "item", "pieces", "piece",
  "dozen", "couple", "pair", "half", "just", "in", "gone", "bad",
]);

const DATE_WORDS: Record<string, number> = { yesterday: -1, today: 0, tomorrow: 1 };

function isoDay(base: Date, offsetDays: number): string {
  const d = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate() + offsetDays));
  return d.toISOString().slice(0, 10);
}

interface QuantityHit {
  value: number;
  start: number;
  end: number; // token index (exclusive)
  text: string;
}

/** Finds the first spoken or written quantity in a token list. */
export function findQuantity(tokens: string[]): QuantityHit | null {
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    const next = tokens[i + 1];
    if (/^\d+(\.\d+)?$/.test(t)) return { value: Number(t), start: i, end: i + 1, text: t };
    if (t === "a" || t === "an") {
      if (next === "dozen") return { value: 12, start: i, end: i + 2, text: "a dozen" };
      if (next === "couple") return { value: 2, start: i, end: tokens[i + 2] === "of" ? i + 3 : i + 2, text: "a couple" };
      if (next === "pair") return { value: 2, start: i, end: tokens[i + 2] === "of" ? i + 3 : i + 2, text: "a pair" };
      if (next && UNIT_WORDS.has(next)) return { value: 1, start: i, end: i + 1, text: t };
    }
    if (t === "half" && (next === "a" || next === "an")) return { value: 0.5, start: i, end: i + 2, text: "half a" };
    if (t === "dozen") return { value: 12, start: i, end: i + 1, text: "dozen" };
    if (t in TENS) {
      const unitPart = next && next in SMALL && SMALL[next] < 10 && SMALL[next] > 0 ? SMALL[next] : 0;
      const end = unitPart ? i + 2 : i + 1;
      return { value: TENS[t] + unitPart, start: i, end, text: tokens.slice(i, end).join(" ") };
    }
    if (t in SMALL && !(t === "no" && next !== "more")) {
      if (next === "hundred") return { value: SMALL[t] * 100, start: i, end: i + 2, text: `${t} hundred` };
      return { value: SMALL[t], start: i, end: i + 1, text: t };
    }
  }
  return null;
}

function titleCase(s: string): string {
  return s
    .split(" ")
    .filter(Boolean)
    .map((w) => (["aa", "aaa", "usb", "led"].includes(w) ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1)))
    .join(" ");
}

/** Split a transcript into one clause per stock statement. */
export function splitClauses(transcript: string): string[] {
  return transcript
    .replace(/\s+/g, " ")
    .split(/[,;.!?]+|\b(?:and also|also|plus|then)\b|\band\b(?=\s+(?:\d|a |an |one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|twenty|thirty|forty|fifty|we|there|i |the |some))/i)
    .map((c) => c?.trim().replace(/^and\s+/i, ""))
    .filter((c): c is string => Boolean(c && /[a-z]/i.test(c)));
}

function tokenizeClause(clause: string): string[] {
  return clause
    .toLowerCase()
    .replace(/-/g, " ")
    .replace(/[^a-z0-9.'\s/]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

export function parseClause(rawClause: string, now: Date): VoiceActionOutput | null {
  // Batch / lot numbers are pulled out first so they never leak into the product name.
  let batch: string | null = null;
  const batchMatch = /\b(?:batch|lot)\s+(?:number\s+|no\.?\s+|#)?([a-z0-9-]{2,30})\b/i.exec(rawClause);
  if (batchMatch) batch = batchMatch[1].toUpperCase();
  const clause = batchMatch ? rawClause.replace(batchMatch[0], " ") : rawClause;

  const lower = clause.toLowerCase();
  const tokens = tokenizeClause(clause);
  const quantity = findQuantity(tokens);

  let action: VoiceAction = "unclear";
  for (const intent of INTENTS) {
    if (intent.pattern.test(lower)) {
      action = intent.action;
      break;
    }
  }

  // Unit directly after the quantity ("three boxes of …")
  let unit: string | null = null;
  const used = new Set<number>();
  if (quantity) {
    for (let i = quantity.start; i < quantity.end; i++) used.add(i);
    const after = tokens[quantity.end];
    if (after && UNIT_WORDS.has(after)) {
      unit = after;
      used.add(quantity.end);
    }
  }

  // Destination for transfers
  let toLocation: string | null = null;
  if (action === "transfer_stock") {
    const m = /\bto\s+(?:the\s+)?([a-z0-9 ]{2,60})$/i.exec(clause.trim());
    if (m) toLocation = titleCase(m[1].trim());
  }

  // Expiry details
  let expiryStatus: "expired" | "expiring" | null = null;
  let expiryDate: string | null = null;
  if (action === "report_expiry") {
    expiryStatus = /\b(expiring|expires|expire)\b/.test(lower) && !/\bexpired\b/.test(lower) ? "expiring" : "expired";
    const iso = /\b(\d{4}-\d{2}-\d{2})\b/.exec(clause);
    if (iso) expiryDate = iso[1];
    else {
      const rel = /\b(?:expired|expiring|expires|expire)\s+(?:on\s+)?(yesterday|today|tomorrow)\b/.exec(lower);
      if (rel) expiryDate = isoDay(now, DATE_WORDS[rel[1]]);
      const inDays = /\b(?:in)\s+(\d+|one|two|three|four|five|six|seven|ten|fourteen|thirty)\s+days?\b/.exec(lower);
      if (!expiryDate && inDays) {
        const n = /^\d+$/.test(inDays[1]) ? Number(inDays[1]) : SMALL[inDays[1]] ?? TENS[inDays[1]];
        if (n !== undefined) expiryDate = isoDay(now, n);
      }
    }
  }

  const productWords = tokens.filter((t, i) => {
    if (used.has(i)) return false;
    if (FILLER.has(t)) return false;
    if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return false;
    return true;
  });
  // For transfers, drop the destination words.
  let productPhrase = productWords.join(" ").replace(/'s\b/g, "'s").trim();
  if (toLocation) productPhrase = productPhrase.replace(new RegExp(`\\s*${toLocation.toLowerCase()}$`), "").trim();
  if (!productPhrase) return null;

  const productName = titleCase(productPhrase);
  let confidence = 0.86;
  let question: string | null = null;

  if (action === "unclear") {
    confidence = 0.4;
    const qty = quantity?.text ?? "those";
    const phrase = [unit, productPhrase].filter(Boolean).join(" of ");
    question = /\b(have|got)\b/.test(lower)
      ? `Do you mean ${qty} ${phrase} are currently available, or ${qty} new ${phrase} have arrived?`
      : `What happened to the ${productPhrase}? Were they counted, received, sold, damaged, expired or missing?`;
  } else if (!quantity && action !== "report_expiry") {
    confidence = 0.55;
    question = `How many ${unit ?? ""} ${productPhrase} ${verbFor(action)}?`.replace(/\s+/g, " ");
  } else if (!quantity) {
    confidence = 0.55;
    question = `How many ${productPhrase} have ${expiryStatus === "expiring" ? "an upcoming expiry" : "expired"}?`;
  }
  if (productWords.length === 1 && productWords[0].length < 3) confidence = Math.min(confidence, 0.4);

  return {
    product_name: productName,
    action,
    quantity: quantity ? quantity.value : null,
    unit,
    expiry_status: expiryStatus,
    expiry_date: expiryDate,
    batch_number: batch,
    to_location: toLocation,
    confidence,
    evidence: rawClause.trim().slice(0, 500),
    clarification_question: question,
  };
}

function verbFor(action: VoiceAction): string {
  switch (action) {
    case "set_stock": return "are left";
    case "receive_stock": return "arrived";
    case "sell_stock": return "were sold";
    case "report_damage": return "are damaged";
    case "report_missing": return "are missing";
    case "transfer_stock": return "were moved";
    default: return "changed";
  }
}

export function parseVoiceCommandLocally(transcript: string, now = new Date()): VoiceExtraction {
  const actions = splitClauses(transcript)
    .map((c) => parseClause(c, now))
    .filter((a): a is VoiceActionOutput => a !== null)
    .slice(0, 50);

  const questions = actions.map((a) => a.clarification_question).filter((q): q is string => Boolean(q));
  if (actions.length === 0) questions.push("I didn't catch any inventory changes. Could you say the product, the quantity and what happened?");

  const overall = actions.length === 0 ? 0 : Math.min(...actions.map((a) => a.confidence));
  return { actions, clarification_questions: questions.slice(0, 10), overall_confidence: overall };
}
