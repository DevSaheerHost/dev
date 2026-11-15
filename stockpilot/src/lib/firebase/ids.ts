import { createHash, randomBytes } from "node:crypto";

/** Deterministic, Firestore-safe document id derived from arbitrary text. */
export function hashId(...parts: (string | number | null | undefined)[]): string {
  return createHash("sha256").update(parts.map((p) => String(p ?? "")).join("\u001f")).digest("hex").slice(0, 40);
}

/** Random document id (base64url, 20 chars). */
export function newId(): string {
  return randomBytes(15).toString("base64url");
}

/** Only allow ids we generated (or Firestore auto ids) to reach a path. */
export function isDocId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{8,64}$/.test(value);
}
