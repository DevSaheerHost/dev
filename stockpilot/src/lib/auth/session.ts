import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { MemberRole } from "@/lib/domain/types";

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
  autoSendPurchaseOrders: boolean;
}

export interface Membership {
  businessId: string;
  businessName: string;
  role: MemberRole;
}

export interface AppContext {
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>;
  userId: string;
  email: string | null;
  fullName: string | null;
  role: MemberRole;
  business: BusinessSummary;
  memberships: Membership[];
}

type ContextResult =
  | { status: "ok"; context: AppContext }
  | { status: "unauthenticated" }
  | { status: "no_business"; userId: string; email: string | null };

/** Resolves the signed-in user, their memberships and the active business. */
export const resolveContext = cache(async (): Promise<ContextResult> => {
  const supabase = await createSupabaseServerClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const claims = claimsData?.claims;
  const userId = claims?.sub as string | undefined;
  if (!userId) return { status: "unauthenticated" };
  const email = (claims?.email as string | undefined) ?? null;

  const { data: rows } = await supabase
    .from("business_members")
    .select("business_id, role, businesses(name)")
    .eq("user_id", userId)
    .eq("status", "active")
    .order("created_at");

  const memberships: Membership[] = (rows ?? []).map((r) => ({
    businessId: r.business_id as string,
    role: r.role as MemberRole,
    businessName: ((r.businesses as unknown as { name: string } | null)?.name ?? "Business") as string,
  }));
  if (memberships.length === 0) return { status: "no_business", userId, email };

  const preferred = (await cookies()).get(ACTIVE_BUSINESS_COOKIE)?.value;
  const active = memberships.find((m) => m.businessId === preferred) ?? memberships[0];

  const [{ data: business }, { data: profile }] = await Promise.all([
    supabase
      .from("businesses")
      .select("id, name, business_type, currency, timezone, large_adjustment_units, large_adjustment_percent, expiry_warning_days, auto_send_purchase_orders")
      .eq("id", active.businessId)
      .single(),
    supabase.from("profiles").select("full_name").eq("id", userId).maybeSingle(),
  ]);
  if (!business) return { status: "no_business", userId, email };

  return {
    status: "ok",
    context: {
      supabase,
      userId,
      email,
      fullName: (profile?.full_name as string | null) || null,
      role: active.role,
      memberships,
      business: {
        id: business.id,
        name: business.name,
        businessType: business.business_type,
        currency: business.currency,
        timezone: business.timezone,
        largeAdjustmentUnits: Number(business.large_adjustment_units),
        largeAdjustmentPercent: Number(business.large_adjustment_percent),
        expiryWarningDays: business.expiry_warning_days,
        autoSendPurchaseOrders: business.auto_send_purchase_orders,
      },
    },
  };
});

/** For pages: redirects to login/onboarding when there is no usable context. */
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

/** For pages restricted to a role: sends others back to the dashboard. */
export async function requireRole(min: MemberRole): Promise<AppContext> {
  const ctx = await requireContext();
  if (!hasRole(ctx.role, min)) redirect("/dashboard?denied=1");
  return ctx;
}
