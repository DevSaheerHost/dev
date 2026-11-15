"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { ACTIVE_BUSINESS_COOKIE, getSessionUser } from "@/lib/auth/session";
import { acceptInvitation as accept, createBusiness as create } from "@/lib/data/business";
import { AppError } from "@/lib/errors";

export interface FormState {
  error?: string;
  message?: string;
  fieldErrors?: Record<string, string>;
}

function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) out[String(issue.path[0])] ??= issue.message;
  return out;
}

async function setActiveBusiness(id: string) {
  (await cookies()).set(ACTIVE_BUSINESS_COOKIE, id, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 31536000 });
}

export async function createBusiness(_: FormState, formData: FormData): Promise<FormState> {
  const user = await getSessionUser();
  if (!user) redirect("/login?next=/onboarding");
  const parsed = z
    .object({
      name: z.string().trim().min(2, "Enter the store name.").max(120),
      businessType: z.enum(["retail", "hardware", "grocery", "pharmacy", "convenience", "other"]),
      currency: z.string().regex(/^[A-Z]{3}$/, "Choose a currency."),
      timezone: z.string().min(1).max(64).refine((tz) => { try { Intl.DateTimeFormat("en-US", { timeZone: tz }); return true; } catch { return false; } }, "Unknown time zone."),
      locationName: z.string().trim().max(120).optional(),
    })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };
  let id: string;
  try {
    id = await create(user, { ...parsed.data, locationName: parsed.data.locationName || "Main store" });
  } catch (e) {
    return { error: e instanceof AppError ? e.message : "Couldn't create the business. Please try again." };
  }
  await setActiveBusiness(id);
  redirect("/dashboard?welcome=1");
}

export async function acceptInvitation(_: FormState, formData: FormData): Promise<FormState> {
  const user = await getSessionUser();
  if (!user) return { error: "Please sign in first." };
  let id: string;
  try {
    id = await accept(user, String(formData.get("token") ?? ""));
  } catch (e) {
    return { error: e instanceof AppError ? e.message : "This invitation couldn't be accepted." };
  }
  await setActiveBusiness(id);
  redirect("/dashboard");
}
