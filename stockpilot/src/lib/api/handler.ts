import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { hasRole, resolveContext, type AppContext } from "@/lib/auth/session";
import { rateLimit } from "@/lib/data/rate-limit";
import type { MemberRole } from "@/lib/domain/types";
import { AppError } from "@/lib/errors";

export { AppError as ApiError, rateLimit };

export function jsonError(error: unknown): NextResponse {
  if (error instanceof AppError) {
    return NextResponse.json({ error: { code: error.code, message: error.message, details: error.details } }, { status: error.status });
  }
  console.error("Unhandled API error", error);
  return NextResponse.json({ error: { code: "internal", message: "Something went wrong." } }, { status: 500 });
}

/** Rejects cross-site state-changing requests (defence in depth on top of SameSite cookies). */
export function assertSameOrigin(request: NextRequest): void {
  if (request.method === "GET" || request.method === "HEAD") return;
  const origin = request.headers.get("origin");
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  let ok = false;
  try {
    ok = !!origin && !!host && new URL(origin).host === host;
  } catch {
    ok = false;
  }
  if (!ok) throw new AppError(403, "bad_origin", "Cross-site request blocked.");
}

const MAX_JSON_BYTES = 256 * 1024;

export async function readJson<T>(request: NextRequest, schema: z.ZodType<T>): Promise<T> {
  if (Number(request.headers.get("content-length") ?? "0") > MAX_JSON_BYTES) throw new AppError(413, "too_large", "Request body is too large.");
  let raw: unknown;
  try {
    const text = await request.text();
    if (text.length > MAX_JSON_BYTES) throw new AppError(413, "too_large", "Request body is too large.");
    raw = JSON.parse(text);
  } catch (e) {
    if (e instanceof AppError) throw e;
    throw new AppError(400, "invalid_json", "Request body must be JSON.");
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new AppError(400, "invalid_input", "Some fields are invalid.", parsed.error.issues.slice(0, 5).map((i) => ({ path: i.path.join("."), message: i.message })));
  }
  return parsed.data;
}

export function clientIp(request: NextRequest): string {
  return (request.headers.get("x-forwarded-for")?.split(",")[0] ?? request.headers.get("x-real-ip") ?? "unknown").trim().slice(0, 64);
}

export async function requireApiContext(minRole: MemberRole = "employee"): Promise<AppContext> {
  const result = await resolveContext();
  if (result.status === "unauthenticated") throw new AppError(401, "unauthenticated", "Please sign in.");
  if (result.status === "no_business") throw new AppError(403, "no_business", "Create or join a business first.");
  if (!hasRole(result.context.role, minRole)) throw new AppError(403, "forbidden", "You don't have permission to do that.");
  return result.context;
}

type Handler<P> = (request: NextRequest, ctx: AppContext, params: P) => Promise<Response>;

/** Authenticated API route: same-origin check, verified session, role, rate limit, error mapping. */
export function authedRoute<P = Record<string, string>>(
  options: { minRole?: MemberRole; rateLimit?: { name: string; limit: number; windowSeconds: number } },
  handler: Handler<P>,
) {
  return async (request: NextRequest, route: { params: Promise<P> }) => {
    try {
      assertSameOrigin(request);
      const ctx = await requireApiContext(options.minRole);
      if (options.rateLimit) await rateLimit(`${options.rateLimit.name}:${ctx.userId}`, options.rateLimit.limit, options.rateLimit.windowSeconds);
      return await handler(request, ctx, await route.params);
    } catch (error) {
      return jsonError(error);
    }
  };
}
