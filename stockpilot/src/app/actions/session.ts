"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { ACTIVE_BUSINESS_COOKIE, resolveContext } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function switchBusiness(formData: FormData) {
  const id = z.uuid().safeParse(formData.get("businessId"));
  const ctx = await resolveContext();
  if (!id.success || ctx.status !== "ok") return;
  // Only switch to a business the user is actually a member of.
  if (!ctx.context.memberships.some((m) => m.businessId === id.data)) return;
  (await cookies()).set(ACTIVE_BUSINESS_COOKIE, id.data, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  redirect("/dashboard");
}

export async function signOut() {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  (await cookies()).delete(ACTIVE_BUSINESS_COOKIE);
  redirect("/login");
}
