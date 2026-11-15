import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { hasRole, resolveContext, type AppContext } from "@/lib/auth/session";
import type { MemberRole } from "@/lib/domain/types";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

interface DbError {
  code?: string;
  message?: string;
}

/** Map database errors to user-facing API errors without leaking internals. */
export function fromDbError(error: DbError | null | undefined, fallback = "Something went wrong."): ApiError {
  const message = error?.message ?? "";
  const [prefix] = message.split(":");
  const known: Record<string, [number, string]> = {
    approval_required: [403, "This change is large enough to need a manager's approval."],
    insufficient_stock: [409, "Not enough stock recorded to remove that many. Do a stock count instead."],
    insufficient_batch_stock: [409, "That batch doesn't have that many left."],
    stale_observation: [409, "Stock changed after this count was taken, so it wasn't applied. Count again to be safe."],
    idempotency_conflict: [409, "This request was already used for a different change."],
    product_not_found: [404, "Product not found."],
    product_archived: [409, "This product is archived."],
    batch_not_found: [404, "Batch not found."],
    review_item_not_found: [404, "This suggestion no longer exists."],
    review_item_closed: [409, "This suggestion was already handled."],
    purchase_order_not_found: [404, "Purchase order not found."],
    purchase_order_locked: [409, "Only draft purchase orders can be edited."],
    invalid_transition: [409, message.split(":").slice(1).join(":").trim() || "That action isn't allowed right now."],
    supplier_not_found: [404, "Supplier not found."],
    invalid_quantity: [400, message.split(":").slice(1).join(":").trim() || "Invalid quantity."],
    invalid_invitation: [400, "This invitation is invalid or has expired."],
    invitation_email_mismatch: [403, "This invitation was sent to a different email address."],
    last_owner: [409, "A business must keep at least one owner."],
    limit_reached: [429, message.split(":").slice(1).join(":").trim() || "Limit reached."],
    cross_tenant_reference: [403, "That record belongs to another business."],
    not_authenticated: [401, "Please sign in again."],
    forbidden: [403, "You don't have permission to do that."],
  };
  if (known[prefix]) return new ApiError(known[prefix][0], prefix, known[prefix][1]);
  if (error?.code === "42501") return new ApiError(403, "forbidden", "You don't have permission to do that.");
  if (error?.code === "23505") return new ApiError(409, "duplicate", "A record with these details already exists.");
  if (error?.code === "23514" || error?.code === "22P02" || error?.code === "22023") {
    return new ApiError(400, "invalid_input", "Some values are not valid.");
  }
  console.error("Unexpected database error", { code: error?.code, message });
  return new ApiError(500, "internal", fallback);
}

export function jsonError(error: unknown): NextResponse {
  if (error instanceof ApiError) {
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
  if (!origin || !host) throw new ApiError(403, "bad_origin", "Cross-site request blocked.");
  try {
    if (new URL(origin).host !== host) throw new ApiError(403, "bad_origin", "Cross-site request blocked.");
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw new ApiError(403, "bad_origin", "Cross-site request blocked.");
  }
}

const MAX_JSON_BYTES = 256 * 1024;

export async function readJson<T>(request: NextRequest, schema: z.ZodType<T>): Promise<T> {
  const length = Number(request.headers.get("content-length") ?? "0");
  if (length > MAX_JSON_BYTES) throw new ApiError(413, "too_large", "Request body is too large.");
  let raw: unknown;
  try {
    const text = await request.text();
    if (text.length > MAX_JSON_BYTES) throw new ApiError(413, "too_large", "Request body is too large.");
    raw = JSON.parse(text);
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw new ApiError(400, "invalid_json", "Request body must be JSON.");
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new ApiError(400, "invalid_input", "Some fields are invalid.", parsed.error.issues.slice(0, 5).map((i) => ({ path: i.path.join("."), message: i.message })));
  }
  return parsed.data;
}

/** Fixed-window rate limit backed by Postgres. Fails closed. */
export async function rateLimit(key: string, limit: number, windowSeconds: number): Promise<void> {
  let allowed = false;
  try {
    const { data, error } = await createSupabaseAdminClient().rpc("check_rate_limit", {
      p_key: key,
      p_limit: limit,
      p_window_seconds: windowSeconds,
    });
    if (error) throw error;
    allowed = data === true;
  } catch (e) {
    console.error("Rate limiter unavailable", e);
    throw new ApiError(503, "rate_limiter_unavailable", "Service temporarily unavailable. Please try again.");
  }
  if (!allowed) throw new ApiError(429, "rate_limited", "Too many requests. Please wait a moment and try again.");
}

export async function requireApiContext(minRole: MemberRole = "employee"): Promise<AppContext> {
  const result = await resolveContext();
  if (result.status === "unauthenticated") throw new ApiError(401, "unauthenticated", "Please sign in.");
  if (result.status === "no_business") throw new ApiError(403, "no_business", "Create or join a business first.");
  if (!hasRole(result.context.role, minRole)) throw new ApiError(403, "forbidden", "You don't have permission to do that.");
  return result.context;
}

type Handler<P> = (request: NextRequest, ctx: AppContext, params: P) => Promise<Response>;

/** Authenticated API route: same-origin check, context, role, error mapping. */
export function authedRoute<P = Record<string, string>>(
  options: { minRole?: MemberRole; rateLimit?: { name: string; limit: number; windowSeconds: number } },
  handler: Handler<P>,
) {
  return async (request: NextRequest, route: { params: Promise<P> }) => {
    try {
      assertSameOrigin(request);
      const ctx = await requireApiContext(options.minRole);
      if (options.rateLimit) {
        await rateLimit(`${options.rateLimit.name}:${ctx.userId}`, options.rateLimit.limit, options.rateLimit.windowSeconds);
      }
      return await handler(request, ctx, await route.params);
    } catch (error) {
      return jsonError(error);
    }
  };
}
