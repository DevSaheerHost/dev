import "server-only";
import { z } from "zod";
import { fromDbError } from "@/lib/api/handler";

export type ActionResult<T = undefined> = { ok: true; data?: T; message?: string } | { ok: false; error: string; fieldErrors?: Record<string, string> };

export type ActionFailure = { ok: false; error: string; fieldErrors?: Record<string, string> };

export function zodFailure(error: z.ZodError): ActionFailure {
  const fieldErrors: Record<string, string> = {};
  for (const issue of error.issues) fieldErrors[String(issue.path[0])] ??= issue.message;
  return { ok: false, error: "Please fix the highlighted fields.", fieldErrors };
}

export function dbFailure(error: { code?: string; message?: string } | null, fallback?: string): ActionFailure {
  return { ok: false, error: fromDbError(error, fallback).message };
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
