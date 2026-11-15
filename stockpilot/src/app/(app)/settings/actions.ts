"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireContext } from "@/lib/auth/session";
import { dbFailure, optionalText, zodFailure, type ActionResult } from "@/lib/actions";
import { MEMBER_ROLES } from "@/lib/domain/types";
import { publicEnv } from "@/lib/env";
import { sendEmail } from "@/lib/services/channels";

export async function updateProfile(_: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const ctx = await requireContext();
  const parsed = z.object({ fullName: z.string().trim().min(1, "Enter your name.").max(120) }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return zodFailure(parsed.error);
  const { error } = await ctx.supabase.from("profiles").update({ full_name: parsed.data.fullName }).eq("id", ctx.userId);
  if (error) return dbFailure(error);
  revalidatePath("/", "layout");
  return { ok: true, message: "Profile saved." };
}

const businessSchema = z.object({
  name: z.string().trim().min(2).max(120),
  currency: z.string().regex(/^[A-Z]{3}$/),
  timezone: z.string().min(1).max(64).refine((tz) => { try { Intl.DateTimeFormat("en-US", { timeZone: tz }); return true; } catch { return false; } }, "Unknown time zone."),
  largeAdjustmentUnits: z.coerce.number().positive("Must be above 0.").max(1_000_000),
  largeAdjustmentPercent: z.coerce.number().positive("Must be above 0.").max(1000),
  expiryWarningDays: z.coerce.number().int().min(1).max(365),
});

export async function updateBusiness(_: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const ctx = await requireContext();
  if (ctx.role !== "owner") return { ok: false, error: "Only the owner can change business settings." };
  const parsed = businessSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return zodFailure(parsed.error);
  const b = parsed.data;
  const { error } = await ctx.supabase.from("businesses").update({
    name: b.name, currency: b.currency, timezone: b.timezone, large_adjustment_units: b.largeAdjustmentUnits,
    large_adjustment_percent: b.largeAdjustmentPercent, expiry_warning_days: b.expiryWarningDays,
  }).eq("id", ctx.business.id);
  if (error) return dbFailure(error);
  revalidatePath("/", "layout");
  return { ok: true, message: "Business settings saved." };
}

export async function inviteMember(_: ActionResult<{ link: string; emailed: boolean }> | null, formData: FormData): Promise<ActionResult<{ link: string; emailed: boolean }>> {
  const ctx = await requireContext();
  if (ctx.role !== "owner") return { ok: false, error: "Only the owner can invite people." };
  const parsed = z.object({ email: z.email("Enter a valid email.").max(254), role: z.enum(["manager", "employee"]) }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return zodFailure(parsed.error);
  const { data: token, error } = await ctx.supabase.rpc("create_invitation", { p_business_id: ctx.business.id, p_email: parsed.data.email, p_role: parsed.data.role });
  if (error || !token) return dbFailure(error);
  const link = `${publicEnv().NEXT_PUBLIC_APP_URL}/invite/${token}`;
  const mail = await sendEmail(parsed.data.email, `You're invited to ${ctx.business.name} on StockPilot`, `${ctx.fullName ?? "The owner"} invited you to help manage inventory at ${ctx.business.name} as ${parsed.data.role}.\n\nAccept the invitation (valid 7 days):\n${link}\n\nIf you weren't expecting this, you can ignore this email.`);
  revalidatePath("/settings");
  return { ok: true, data: { link, emailed: mail.sent }, message: mail.sent ? "Invitation emailed." : "Invitation created. Share the link below." };
}

export async function revokeInvitation(id: string): Promise<ActionResult> {
  const ctx = await requireContext();
  if (!z.uuid().safeParse(id).success) return { ok: false, error: "Invalid invitation." };
  const { error } = await ctx.supabase.from("business_invitations").delete().eq("id", id).eq("business_id", ctx.business.id);
  if (error) return dbFailure(error);
  revalidatePath("/settings");
  return { ok: true };
}

export async function updateMember(memberId: string, patch: { role?: string; status?: string }): Promise<ActionResult> {
  const ctx = await requireContext();
  if (ctx.role !== "owner") return { ok: false, error: "Only the owner can change roles." };
  const parsed = z.object({ role: z.enum(MEMBER_ROLES).optional(), status: z.enum(["active", "disabled"]).optional() }).safeParse(patch);
  if (!parsed.success || !z.uuid().safeParse(memberId).success) return { ok: false, error: "Invalid change." };
  const { error } = await ctx.supabase.from("business_members").update(parsed.data).eq("id", memberId).eq("business_id", ctx.business.id);
  if (error) return dbFailure(error);
  revalidatePath("/settings");
  return { ok: true, message: "Member updated." };
}

export async function removeMember(memberId: string): Promise<ActionResult> {
  const ctx = await requireContext();
  if (!z.uuid().safeParse(memberId).success) return { ok: false, error: "Invalid member." };
  const { error } = await ctx.supabase.from("business_members").delete().eq("id", memberId).eq("business_id", ctx.business.id);
  if (error) return dbFailure(error);
  revalidatePath("/settings");
  return { ok: true, message: "Removed from the business." };
}

export async function saveLocation(_: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const ctx = await requireContext();
  const parsed = z.object({ name: z.string().trim().min(1).max(120), address: optionalText(500) }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return zodFailure(parsed.error);
  const { error } = await ctx.supabase.from("business_locations").insert({ business_id: ctx.business.id, name: parsed.data.name, address: parsed.data.address });
  if (error) return dbFailure(error);
  revalidatePath("/settings");
  return { ok: true, message: "Location added." };
}

export async function deleteLocation(id: string): Promise<ActionResult> {
  const ctx = await requireContext();
  if (!z.uuid().safeParse(id).success) return { ok: false, error: "Invalid location." };
  const { error } = await ctx.supabase.from("business_locations").delete().eq("id", id).eq("business_id", ctx.business.id).eq("is_primary", false);
  if (error) return dbFailure(error);
  revalidatePath("/settings");
  return { ok: true };
}

const TYPES = ["low_stock", "out_of_stock", "expiring", "expired", "sync_failed", "po_pending", "ai_review"] as const;

export async function saveNotificationPrefs(_: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const ctx = await requireContext();
  const raw = Object.fromEntries(formData);
  const number = typeof raw.whatsappNumber === "string" ? raw.whatsappNumber.replace(/[\s()-]/g, "") : "";
  if (number && !/^\+?[0-9]{7,15}$/.test(number)) return { ok: false, error: "Enter a WhatsApp number with country code.", fieldErrors: { whatsappNumber: "Digits with country code." } };
  const { error } = await ctx.supabase.from("notification_preferences").upsert({
    business_id: ctx.business.id, user_id: ctx.userId,
    email_enabled: raw.email === "on", push_enabled: raw.push === "on", whatsapp_enabled: raw.whatsapp === "on" && !!number,
    whatsapp_number: number || null,
    types: Object.fromEntries(TYPES.map((t) => [t, raw[`type_${t}`] === "on"])),
  });
  if (error) return dbFailure(error);
  return { ok: true, message: "Notification preferences saved." };
}

export async function leaveBusiness(): Promise<ActionResult> {
  const ctx = await requireContext();
  const { data: me } = await ctx.supabase.from("business_members").select("id").eq("business_id", ctx.business.id).eq("user_id", ctx.userId).single();
  if (!me) return { ok: false, error: "Membership not found." };
  return removeMember(me.id);
}
