"use client";
import { outcomeFromResponse, type OfflineOperation, type SendOutcome } from "./queue";

async function errorText(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: { message?: string } };
    return body.error?.message ?? res.statusText;
  } catch {
    return res.statusText || `HTTP ${res.status}`;
  }
}

/** Replays a queued operation. The op id is the idempotency key, so retries are safe. */
export async function sendOperation(op: OfflineOperation, blob: Blob | null): Promise<SendOutcome> {
  if (typeof navigator !== "undefined" && !navigator.onLine) return { result: "retry", error: "Offline" };
  let res: Response;
  switch (op.kind) {
    case "voice_draft":
      res = await fetch("/api/voice/extract", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...(op.payload as object), clientDraftId: op.id }),
      });
      break;
    case "photo_draft": {
      if (!blob) return { result: "rejected", error: "Photo data missing" };
      const form = new FormData();
      form.set("image", blob, "photo");
      form.set("mode", (op.payload as { mode: string }).mode);
      form.set("clientDraftId", op.id);
      res = await fetch("/api/photo/analyze", { method: "POST", body: form });
      break;
    }
    case "review_apply":
      res = await fetch("/api/review/apply", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(op.payload) });
      break;
    case "stock_movement":
      res = await fetch("/api/stock/movements", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...(op.payload as object), idempotencyKey: `offline:${op.id}` }),
      });
      break;
  }
  return outcomeFromResponse(res, res.ok ? "" : await errorText(res));
}
