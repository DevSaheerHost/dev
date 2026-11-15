import { NextResponse, type NextRequest } from "next/server";
import { refreshSession } from "@/lib/supabase/proxy-session";

const PUBLIC_PREFIXES = ["/login", "/signup", "/auth", "/invite", "/offline", "/forgot-password"];

function contentSecurityPolicy(nonce: string): string {
  const supabase = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const supabaseWs = supabase.replace(/^http/, "ws");
  const isDev = process.env.NODE_ENV === "development";
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    // Inline style attributes are used by charts; no inline scripts are allowed.
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' blob: data: ${supabase}`.trim(),
    "media-src 'self' blob:",
    "font-src 'self'",
    `connect-src 'self' ${supabase} ${supabaseWs}`.trim(),
    "worker-src 'self'",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(isDev ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");
}

export async function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const csp = contentSecurityPolicy(nonce);

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  const { userId, response } = await refreshSession(request, requestHeaders);
  const { pathname, search } = request.nextUrl;
  const isPublic = pathname === "/" || PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));

  let result = response;
  if (!userId && !isPublic) {
    const login = new URL("/login", request.url);
    login.searchParams.set("next", `${pathname}${search}`);
    result = NextResponse.redirect(login);
    // Keep any cookie changes (e.g. cleared expired session).
    for (const cookie of response.cookies.getAll()) result.cookies.set(cookie);
  } else if (userId && (pathname === "/login" || pathname === "/signup")) {
    result = NextResponse.redirect(new URL("/dashboard", request.url));
  }

  result.headers.set("Content-Security-Policy", csp);
  return result;
}

export const config = {
  matcher: [
    {
      source: "/((?!api|_next/static|_next/image|favicon.ico|manifest.webmanifest|sw.js|icons/).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
