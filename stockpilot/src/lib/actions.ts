import "server-only";
import { z } from "zod";
import { AppError } from "@/lib/errors";

export type ActionResult<T = void> = { ok: true; data?: T; message?: string } | { ok: false; error: string; fieldErrors?: Record<string, string> };

export type ActionFailure = { ok: false; error: string; fieldErrors?: Record<string, string> };

export function zodFailure(error: z.ZodError): ActionFailure {
  const fieldErrors: Record<string, string> = {};
  for (const issue of error.issues) fieldErrors[String(issue.path[0])] ??= issue.message;
  return { ok: false, error: "Please fix the highlighted fields.", fieldErrors };
}

/** Turn any thrown error into a safe action failure (AppErrors carry user-facing messages). */
export function failure(e: unknown, fallback = "Something went wrong. Please try again."): ActionFailure {
  if (e instanceof AppError) return { ok: false, error: e.message };
  console.error("Action failed", e);
  return { ok: false, error: fallback };
}

/** Run a mutation and map errors; returns `ok` with an optional message/data. */
export async function attempt<T = undefined>(fn: () => Promise<T>, message?: string): Promise<ActionResult<T>> {
  try {
    const data = await fn();
    return { ok: true, data, message };
  } catch (e) {
    return failure(e);
  }
}

/** Text input: trims, empty → null. */
export const optionalText = (max: number) =>
  z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? null : typeof v === "string" ? v.trim() : v), z.string().max(max).nullable().default(null));

export const optionalNumber = (min = 0, max = 10_000_000) =>
  z.preprocess((v) => (v === "" || v === null || v === undefined ? null : Number(v)), z.number().min(min).max(max).nullable().default(null));

export const isoDateOrNull = z.preprocess(
  (v) => (v === "" || v === null || v === undefined ? null : v),
  z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD").nullable().default(null),
);
