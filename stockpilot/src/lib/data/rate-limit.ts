import "server-only";
import { AppError } from "@/lib/errors";
import { db } from "@/lib/firebase/admin";
import { hashId } from "@/lib/firebase/ids";
import { rateLimits } from "./refs";

/** Fixed-window rate limit stored in Firestore (works across serverless instances). Fails closed. */
export async function rateLimit(key: string, limit: number, windowSeconds: number): Promise<void> {
  const ref = rateLimits().doc(hashId(key));
  let allowed = false;
  try {
    allowed = await db().runTransaction(async (tx) => {
      const now = Date.now();
      const cur = (await tx.get(ref)).data();
      const fresh = !cur || cur.windowStart < now - windowSeconds * 1000;
      const count = fresh ? 1 : cur.count + 1;
      tx.set(ref, { windowStart: fresh ? now : cur.windowStart, count, expiresAt: new Date(now + windowSeconds * 2000) } as never);
      return count <= limit;
    });
  } catch (e) {
    console.error("Rate limiter unavailable", e);
    throw new AppError(503, "rate_limiter_unavailable", "Service temporarily unavailable. Please try again.");
  }
  if (!allowed) throw new AppError(429, "rate_limited", "Too many requests. Please wait a moment and try again.");
}
