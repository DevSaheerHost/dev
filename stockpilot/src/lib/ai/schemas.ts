/**
 * AI output contracts. Every model response is parsed with these schemas
 * before anything else looks at it; anything that fails validation is
 * stored for audit and discarded.
 */
import { z } from "zod";

export const PROMPT_VERSION = "2026-11-v1";

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD")
  .refine((s) => !Number.isNaN(Date.parse(`${s}T00:00:00Z`)), "Invalid date");

const shortText = (max: number) => z.string().trim().min(1).max(max);
const confidence = z.number().min(0).max(1);

export const VOICE_ACTIONS = [
  "set_stock", // "we have three left" — absolute count
  "receive_stock", // "four cases arrived"
  "sell_stock", // "sold two"
  "report_damage",
  "report_expiry",
  "report_missing",
  "transfer_stock",
  "correct_stock", // "the count was off by two" (signed)
  "unclear", // intent cannot be determined — must ask
] as const;
export type VoiceAction = (typeof VOICE_ACTIONS)[number];

export const voiceActionSchema = z.object({
  product_name: shortText(200),
  action: z.enum(VOICE_ACTIONS),
  quantity: z.number().min(-1_000_000).max(1_000_000).nullable(),
  unit: z.string().trim().max(32).nullable(),
  expiry_status: z.enum(["expired", "expiring"]).nullable(),
  expiry_date: isoDate.nullable(),
  batch_number: z.string().trim().max(64).nullable(),
  to_location: z.string().trim().max(120).nullable(),
  confidence,
  /** The exact words this action was derived from (for the reviewer). */
  evidence: z.string().trim().max(500),
  clarification_question: z.string().trim().max(300).nullable(),
});
export type VoiceActionOutput = z.infer<typeof voiceActionSchema>;

export const voiceExtractionSchema = z.object({
  actions: z.array(voiceActionSchema).max(50),
  clarification_questions: z.array(z.string().trim().max(300)).max(10),
  overall_confidence: confidence,
});
export type VoiceExtraction = z.infer<typeof voiceExtractionSchema>;

export const PHOTO_MODES = ["shelf", "packing_slip", "damage", "expiry_label"] as const;
export type PhotoMode = (typeof PHOTO_MODES)[number];

export const detectedProductSchema = z.object({
  product_name: shortText(200),
  brand: z.string().trim().max(120).nullable(),
  /** Count read from the image. Shelf photos only ever show what is visible. */
  quantity: z.number().min(0).max(1_000_000).nullable(),
  quantity_kind: z.enum(["visible", "estimated", "document"]),
  unit: z.string().trim().max(32).nullable(),
  confidence,
  expiry_date: isoDate.nullable(),
  batch_number: z.string().trim().max(64).nullable(),
  condition: z.enum(["ok", "damaged", "expired", "unknown"]),
  notes: z.string().trim().max(300),
});
export type DetectedProduct = z.infer<typeof detectedProductSchema>;

export const photoExtractionSchema = z.object({
  image_kind: z.enum(["shelf", "packing_slip", "damaged_goods", "expiry_label", "unrelated", "unreadable"]),
  detected_products: z.array(detectedProductSchema).max(60),
  document: z
    .object({
      supplier_name: z.string().trim().max(200).nullable(),
      document_number: z.string().trim().max(100).nullable(),
      document_date: isoDate.nullable(),
    })
    .nullable(),
  warnings: z.array(z.string().trim().max(300)).max(10),
  overall_confidence: confidence,
});
export type PhotoExtraction = z.infer<typeof photoExtractionSchema>;

export const transcriptionSchema = z.object({
  transcript: z.string().trim().max(5000),
  language: z.string().trim().max(16).nullable(),
  confidence,
});

/** Gemini structured-output schema (OpenAPI subset) mirroring the zod schemas. */
type GeminiSchema = Record<string, unknown>;
const str = (nullable = false, extra: GeminiSchema = {}): GeminiSchema => ({ type: "STRING", nullable, ...extra });
const num = (nullable = false): GeminiSchema => ({ type: "NUMBER", nullable });
const obj = (properties: Record<string, GeminiSchema>, nullable = false): GeminiSchema => ({
  type: "OBJECT",
  nullable,
  properties,
  required: Object.keys(properties),
  propertyOrdering: Object.keys(properties),
});

export const geminiVoiceSchema: GeminiSchema = obj({
  actions: {
    type: "ARRAY",
    items: obj({
      product_name: str(),
      action: str(false, { enum: [...VOICE_ACTIONS] }),
      quantity: num(true),
      unit: str(true),
      expiry_status: str(true, { enum: ["expired", "expiring"] }),
      expiry_date: str(true),
      batch_number: str(true),
      to_location: str(true),
      confidence: num(),
      evidence: str(),
      clarification_question: str(true),
    }),
  },
  clarification_questions: { type: "ARRAY", items: str() },
  overall_confidence: num(),
});

export const geminiPhotoSchema: GeminiSchema = obj({
  image_kind: str(false, { enum: ["shelf", "packing_slip", "damaged_goods", "expiry_label", "unrelated", "unreadable"] }),
  detected_products: {
    type: "ARRAY",
    items: obj({
      product_name: str(),
      brand: str(true),
      quantity: num(true),
      quantity_kind: str(false, { enum: ["visible", "estimated", "document"] }),
      unit: str(true),
      confidence: num(),
      expiry_date: str(true),
      batch_number: str(true),
      condition: str(false, { enum: ["ok", "damaged", "expired", "unknown"] }),
      notes: str(),
    }),
  },
  document: obj({ supplier_name: str(true), document_number: str(true), document_date: str(true) }, true),
  warnings: { type: "ARRAY", items: str() },
  overall_confidence: num(),
});

export const geminiTranscriptionSchema: GeminiSchema = obj({
  transcript: str(),
  language: str(true),
  confidence: num(),
});

export type ParseResult<T> = { ok: true; data: T } | { ok: false; error: string };

/** Parse untrusted model text as JSON and validate it. Never throws. */
export function parseModelJson<T>(schema: z.ZodType<T>, text: string): ParseResult<T> {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: "Model returned invalid JSON." };
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, error: `Schema validation failed at ${issue?.path.join(".") || "root"}: ${issue?.message}` };
  }
  return { ok: true, data: parsed.data };
}
