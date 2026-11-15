"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { ACTIVE_BUSINESS_COOKIE, resolveContext } from "@/lib/auth/session";

export async function switchBusiness(formData: FormData) {
  const id = z.string().regex(/^[A-Za-z0-9_-]{8,64}$/).safeParse(formData.get("businessId"));
  const ctx = await resolveContext();
  if (!id.success || ctx.status !== "ok") return;
  if (!ctx.context.memberships.some((m) => m.businessId === id.data)) return;
  (await cookies()).set(ACTIVE_BUSINESS_COOKIE, id.data, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 31536000 });
  redirect("/dashboard");
}
