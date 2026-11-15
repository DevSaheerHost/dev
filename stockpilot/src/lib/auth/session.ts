import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { biz, memberships as membershipsRef } from "@/lib/data/refs";
import type { MemberRole } from "@/lib/domain/types";
import { adminAuth } from "@/lib/firebase/admin";

export const SESSION_COOKIE = "__session";
export const ACTIVE_BUSINESS_COOKIE = "sp_business";

export interface BusinessSummary {
  id: string;
  name: string;
  businessType: string;
  currency: string;
  timezone: string;
  largeAdjustmentUnits: number;
  largeAdjustmentPercent: number;
  expiryWarningDays: number;
}

export interface Membership {
  businessId: string;
  businessName: string;
  role: MemberRole;
}

export interface AppContext {
  userId: string;
  email: string | null;
  emailVerified: boolean;
  fullName: string | null;
  role: MemberRole;
  business: BusinessSummary;
  memberships: Membership[];
}

export interface SessionUser {
  userId: string;
  email: string | null;
  emailVerified: boolean;
  fullName: string | null;
}

type ContextResult = { status: "ok"; context: AppContext } | { status: "unauthenticated" } | ({ status: "no_business" } & SessionUser);

/** Verifies the httpOnly session cookie with Firebase, including revocation. */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const cookie = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!cookie || cookie.length > 4096) return null;
  try {
    const decoded = await adminAuth().verifySessionCookie(cookie, true);
    return {
      userId: decoded.uid,
      email: decoded.email ?? null,
      emailVerified: decoded.email_verified === true,
      fullName: (decoded.name as string | undefined) ?? null,
    };
  } catch {
    return null;
  }
});

/** Resolves the signed-in user, memberships and the active business (roles read from the source of truth). */
export const resolveContext = cache(async (): Promise<ContextResult> => {
  const user = await getSessionUser();
  if (!user) return { status: "unauthenticated" };

  const snap = await membershipsRef(user.userId).where("status", "==", "active").get();
  const list: Membership[] = snap.docs.map((d) => ({ businessId: d.id, businessName: d.data().businessName, role: d.data().role }));
  if (list.length === 0) return { status: "no_business", ...user };

  const preferred = (await cookies()).get(ACTIVE_BUSINESS_COOKIE)?.value;
  const candidates = [list.find((m) => m.businessId === preferred), ...list].filter((m): m is Membership => !!m);

  for (const candidate of candidates) {
    const ref = biz(candidate.businessId);
    const [member, business] = await Promise.all([ref.members.doc(user.userId).get(), ref.doc.get()]);
    const m = member.data();
    const b = business.data();
    // The membership mirror is only an index; the member doc decides access.
    if (!m || m.status !== "active" || !b) continue;
    return {
      status: "ok",
      context: {
        ...user,
        fullName: m.fullName ?? user.fullName,
        role: m.role,
        memberships: list,
        business: {
          id: business.id, name: b.name, businessType: b.businessType, currency: b.currency, timezone: b.timezone,
          largeAdjustmentUnits: b.largeAdjustmentUnits, largeAdjustmentPercent: b.largeAdjustmentPercent, expiryWarningDays: b.expiryWarningDays,
        },
      },
    };
  }
  return { status: "no_business", ...user };
});

export async function requireContext(): Promise<AppContext> {
  const result = await resolveContext();
  if (result.status === "unauthenticated") redirect("/login");
  if (result.status === "no_business") redirect("/onboarding");
  return result.context;
}

const RANK: Record<MemberRole, number> = { employee: 1, manager: 2, owner: 3 };
export function hasRole(role: MemberRole, min: MemberRole): boolean {
  return RANK[role] >= RANK[min];
}

export async function requireRole(min: MemberRole): Promise<AppContext> {
  const ctx = await requireContext();
  if (!hasRole(ctx.role, min)) redirect("/dashboard?denied=1");
  return ctx;
}
