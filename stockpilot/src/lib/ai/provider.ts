import "server-only";
import { serverEnv } from "@/lib/env";
import { parseVoiceCommandLocally } from "./local-parser";
import { photoSystemPrompt, TRANSCRIBE_PROMPT, VOICE_SYSTEM_PROMPT, voiceUserPrompt } from "./prompts";
import {
  geminiPhotoSchema,
  geminiTranscriptionSchema,
  geminiVoiceSchema,
  parseModelJson,
  photoExtractionSchema,
  transcriptionSchema,
  voiceExtractionSchema,
  type ParseResult,
  type PhotoExtraction,
  type PhotoMode,
  type VoiceExtraction,
} from "./schemas";

export interface ProviderResult<T> {
  provider: string;
  model: string | null;
  rawText: string | null;
  result: ParseResult<T>;
  latencyMs: number;
}

export class AiUnavailableError extends Error {}

export interface AiProvider {
  readonly name: string;
  readonly model: string | null;
  readonly supportsVision: boolean;
  readonly supportsTranscription: boolean;
  extractVoice(transcript: string, today: string, catalogNames: string[]): Promise<ProviderResult<VoiceExtraction>>;
  analyzePhoto(image: Uint8Array, mime: string, mode: PhotoMode, today: string): Promise<ProviderResult<PhotoExtraction>>;
  transcribe(audio: Uint8Array, mime: string): Promise<ProviderResult<{ transcript: string; language: string | null; confidence: number }>>;
}

class LocalProvider implements AiProvider {
  readonly name = "local";
  readonly model = "rules-v1";
  readonly supportsVision = false;
  readonly supportsTranscription = false;

  async extractVoice(transcript: string, today: string) {
    const started = Date.now();
    const data = parseVoiceCommandLocally(transcript, new Date(`${today}T12:00:00Z`));
    const rawText = JSON.stringify(data);
    return { provider: this.name, model: this.model, rawText, result: parseModelJson(voiceExtractionSchema, rawText), latencyMs: Date.now() - started };
  }
  async analyzePhoto(): Promise<never> {
    throw new AiUnavailableError("Photo recognition needs an AI provider. Ask the owner to configure GEMINI_API_KEY.");
  }
  async transcribe(): Promise<never> {
    throw new AiUnavailableError("Server transcription needs an AI provider. Use the live transcript or type the update.");
  }
}

interface GeminiPart {
  text?: string;
  inlineData?: { mimeType: string; data: string };
}

class GeminiProvider implements AiProvider {
  readonly name = "gemini";
  readonly supportsVision = true;
  readonly supportsTranscription = true;
  constructor(
    private apiKey: string,
    readonly model: string,
  ) {}

  private async generate(system: string, parts: GeminiPart[], schema: Record<string, unknown>) {
    const started = Date.now();
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.model)}:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": this.apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: "user", parts }],
        generationConfig: { temperature: 0.1, responseMimeType: "application/json", responseSchema: schema, maxOutputTokens: 4096 },
      }),
      signal: AbortSignal.timeout(45_000),
    });
    const latencyMs = Date.now() - started;
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.error("Gemini request failed", res.status, detail.slice(0, 500));
      throw new AiUnavailableError(res.status === 429 ? "The AI service is busy. Please try again shortly." : "The AI service could not process this request.");
    }
    const body = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[] };
    const text = body.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? null;
    return { text, latencyMs };
  }

  async extractVoice(transcript: string, today: string, catalogNames: string[]) {
    const { text, latencyMs } = await this.generate(VOICE_SYSTEM_PROMPT, [{ text: voiceUserPrompt(transcript, today, catalogNames) }], geminiVoiceSchema);
    return { provider: this.name, model: this.model, rawText: text, result: text ? parseModelJson(voiceExtractionSchema, text) : { ok: false as const, error: "Empty model response." }, latencyMs };
  }

  async analyzePhoto(image: Uint8Array, mime: string, mode: PhotoMode, today: string) {
    const { text, latencyMs } = await this.generate(
      photoSystemPrompt(mode, today),
      [{ inlineData: { mimeType: mime, data: Buffer.from(image).toString("base64") } }, { text: "Analyze this photo." }],
      geminiPhotoSchema,
    );
    return { provider: this.name, model: this.model, rawText: text, result: text ? parseModelJson(photoExtractionSchema, text) : { ok: false as const, error: "Empty model response." }, latencyMs };
  }

  async transcribe(audio: Uint8Array, mime: string) {
    const { text, latencyMs } = await this.generate(
      TRANSCRIBE_PROMPT,
      [{ inlineData: { mimeType: mime, data: Buffer.from(audio).toString("base64") } }],
      geminiTranscriptionSchema,
    );
    return { provider: this.name, model: this.model, rawText: text, result: text ? parseModelJson(transcriptionSchema, text) : { ok: false as const, error: "Empty model response." }, latencyMs };
  }
}

export function getAiProvider(): AiProvider {
  const env = serverEnv();
  if (env.AI_PROVIDER === "gemini") {
    if (!env.GEMINI_API_KEY) throw new AiUnavailableError("AI_PROVIDER is gemini but GEMINI_API_KEY is not set.");
    return new GeminiProvider(env.GEMINI_API_KEY, env.GEMINI_MODEL);
  }
  return new LocalProvider();
}
