"use server";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { ApiError, rateLimit } from "@/lib/api/handler";
import { ACTIVE_BUSINESS_COOKIE } from "@/lib/auth/session";
import { safeNextPath } from "@/lib/auth/redirect";
import { publicEnv } from "@/lib/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export interface FormState {
  error?: string;
  message?: string;
  fieldErrors?: Record<string, string>;
}

async function clientIp(): Promise<string> {
  const h = await headers();
  return (h.get("x-forwarded-for")?.split(",")[0] ?? h.get("x-real-ip") ?? "unknown").trim().slice(0, 64);
}

async function guard(name: string, limit: number, windowSeconds: number): Promise<string | null> {
  try {
    await rateLimit(`${name}:${await clientIp()}`, limit, windowSeconds);
    return null;
  } catch (e) {
    return e instanceof ApiError ? e.message : "Please try again later.";
  }
}

function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) out[String(issue.path[0])] ??= issue.message;
  return out;
}

const email = z.email("Enter a valid email address.").max(254).transform((v) => v.toLowerCase().trim());

export async function login(_: FormState, formData: FormData): Promise<FormState> {
  const parsed = z
    .object({ email, password: z.string().min(1, "Enter your password.").max(200) })
    .safeParse({ email: formData.get("email"), password: formData.get("password") });
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };
  const limited = await guard("login", 10, 600);
  if (limited) return { error: limited };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) {
    // Generic message: never reveal whether the account exists.
    return { error: error.code === "email_not_confirmed" ? "Please confirm your email first. Check your inbox." : "Email or password is incorrect." };
  }
  redirect(safeNextPath(formData.get("next")));
}

export async function signup(_: FormState, formData: FormData): Promise<FormState> {
  const parsed = z
    .object({
      fullName: z.string().trim().min(2, "Enter your name.").max(120),
      email,
      password: z.string().min(10, "Use at least 10 characters.").max(200),
    })
    .safeParse({ fullName: formData.get("fullName"), email: formData.get("email"), password: formData.get("password") });
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };
  const limited = await guard("signup", 5, 3600);
  if (limited) return { error: limited };

  const next = safeNextPath(formData.get("next"), "/onboarding");
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      data: { full_name: parsed.data.fullName },
      emailRedirectTo: `${publicEnv().NEXT_PUBLIC_APP_URL}/auth/callback?next=${encodeURIComponent(next)}`,
    },
  });
  if (error) {
    if (error.code === "weak_password") return { fieldErrors: { password: "Choose a stronger password." } };
    return { error: "We couldn't create the account. Please check your details and try again." };
  }
  if (data.session) redirect(next);
  return { message: "Check your email to confirm your account, then sign in." };
}

export async function requestPasswordReset(_: FormState, formData: FormData): Promise<FormState> {
  const parsed = z.object({ email }).safeParse({ email: formData.get("email") });
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };
  const limited = await guard("reset", 5, 3600);
  if (limited) return { error: limited };
  const supabase = await createSupabaseServerClient();
  await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: `${publicEnv().NEXT_PUBLIC_APP_URL}/auth/callback?next=/auth/reset`,
  });
  return { message: "If an account exists for that email, a reset link is on its way." };
}

export async function updatePassword(_: FormState, formData: FormData): Promise<FormState> {
  const parsed = z.object({ password: z.string().min(10, "Use at least 10 characters.").max(200) }).safeParse({ password: formData.get("password") });
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) return { error: "Couldn't update the password. The link may have expired." };
  redirect("/dashboard");
}

export async function createBusiness(_: FormState, formData: FormData): Promise<FormState> {
  const parsed = z
    .object({
      name: z.string().trim().min(2, "Enter the store name.").max(120),
      businessType: z.enum(["retail", "hardware", "grocery", "pharmacy", "convenience", "other"]),
      currency: z.string().regex(/^[A-Z]{3}$/, "Choose a currency."),
      timezone: z.string().min(1).max(64),
      locationName: z.string().trim().max(120).optional(),
    })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };
  try {
    Intl.DateTimeFormat("en-US", { timeZone: parsed.data.timezone });
  } catch {
    return { fieldErrors: { timezone: "Unknown time zone." } };
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("create_business", {
    p_name: parsed.data.name,
    p_business_type: parsed.data.businessType,
    p_currency: parsed.data.currency,
    p_timezone: parsed.data.timezone,
    p_location_name: parsed.data.locationName || "Main store",
  });
  if (error || !data) return { error: error?.message.startsWith("limit_reached") ? "You've reached the maximum number of businesses." : "Couldn't create the business. Please try again." };
  (await cookies()).set(ACTIVE_BUSINESS_COOKIE, data as string, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 31536000 });
  redirect("/dashboard?welcome=1");
}

export async function acceptInvitation(_: FormState, formData: FormData): Promise<FormState> {
  const token = z.string().regex(/^[0-9a-f]{64}$/).safeParse(formData.get("token"));
  if (!token.success) return { error: "This invitation link is invalid." };
  const limited = await guard("invite", 20, 3600);
  if (limited) return { error: limited };
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("accept_invitation", { p_token: token.data });
  if (error) {
    return {
      error: error.message.startsWith("invitation_email_mismatch")
        ? "This invitation was sent to a different email address. Sign in with that email to accept it."
        : "This invitation is invalid or has expired. Ask the owner for a new one.",
    };
  }
  (await cookies()).set(ACTIVE_BUSINESS_COOKIE, data as string, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 31536000 });
  redirect("/dashboard");
}
