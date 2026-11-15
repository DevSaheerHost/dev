import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { assertSameOrigin, clientIp, jsonError, rateLimit, readJson } from "@/lib/api/handler";
import { ACTIVE_BUSINESS_COOKIE, SESSION_COOKIE } from "@/lib/auth/session";
import { ensureUserProfile } from "@/lib/data/business";
import { AppError } from "@/lib/errors";
import { adminAuth } from "@/lib/firebase/admin";

const SESSION_DAYS = 5;

/**
 * Exchanges a fresh Firebase ID token for an httpOnly session cookie.
 * The browser never keeps Firebase tokens (in-memory persistence only).
 */
export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    await rateLimit(`session:${clientIp(request)}`, 20, 600);
    const { idToken } = await readJson(request, z.object({ idToken: z.string().min(100).max(4096) }));
    let decoded;
    try {
      decoded = await adminAuth().verifyIdToken(idToken, true);
    } catch {
      throw new AppError(401, "invalid_token", "Your sign-in expired. Please try again.");
    }
    // Only mint sessions right after an actual sign-in.
    if (Date.now() / 1000 - decoded.auth_time > 5 * 60) throw new AppError(401, "stale_login", "Please sign in again.");
    const expiresIn = SESSION_DAYS * 86_400_000;
    const cookie = await adminAuth().createSessionCookie(idToken, { expiresIn });
    await ensureUserProfile(decoded.uid, decoded.email ?? null, (decoded.name as string | undefined) ?? null);
    const res = NextResponse.json({ ok: true });
    res.cookies.set(SESSION_COOKIE, cookie, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: expiresIn / 1000 });
    return res;
  } catch (e) {
    return jsonError(e);
  }
}

/** Signs out everywhere: revokes refresh tokens and clears cookies. */
export async function DELETE(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const cookie = request.cookies.get(SESSION_COOKIE)?.value;
    if (cookie) {
      try {
        const decoded = await adminAuth().verifySessionCookie(cookie);
        await adminAuth().revokeRefreshTokens(decoded.sub);
      } catch {
        // Already invalid: just clear it.
      }
    }
    const res = NextResponse.json({ ok: true });
    res.cookies.delete(SESSION_COOKIE);
    res.cookies.delete(ACTIVE_BUSINESS_COOKIE);
    return res;
  } catch (e) {
    return jsonError(e);
  }
}
