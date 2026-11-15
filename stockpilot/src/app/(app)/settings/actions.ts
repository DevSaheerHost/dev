"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireContext } from "@/lib/auth/session";
import { attempt, optionalText, zodFailure, type ActionResult } from "@/lib/actions";
import * as business from "@/lib/data/business";
import { MEMBER_ROLES } from "@/lib/domain/types";
import { publicEnv } from "@/lib/env";
import { sendEmail } from "@/lib/services/channels";

export async function updateProfile(_: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const ctx = await requireContext();
  const parsed = z.object({ fullName: z.string().trim().min(1, "Enter your name.").max(120) }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return zodFailure(parsed.error);
  const r = await attempt(() => business.updateProfileName(ctx, parsed.data.fullName), "Profile saved.");
  revalidatePath("/", "layout");
  return r;
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
  const parsed = businessSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return zodFailure(parsed.error);
  const r = await attempt(() => business.updateBusinessSettings(ctx, parsed.data), "Business settings saved.");
  revalidatePath("/", "layout");
  return r;
}

export async function inviteMember(_: ActionResult<{ link: string; emailed: boolean }> | null, formData: FormData): Promise<ActionResult<{ link: string; emailed: boolean }>> {
  const ctx = await requireContext();
  const parsed = z.object({ email: z.email("Enter a valid email.").max(254), role: z.enum(["manager", "employee"]) }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return zodFailure(parsed.error);
  const r = await attempt(async () => {
    const token = await business.createInvitation(ctx, parsed.data.email, parsed.data.role);
    const link = `${publicEnv().NEXT_PUBLIC_APP_URL}/invite/${token}`;
    const mail = await sendEmail(parsed.data.email, `You're invited to ${ctx.business.name} on StockPilot`, `${ctx.fullName ?? "The owner"} invited you to help manage inventory at ${ctx.business.name} as ${parsed.data.role}.\n\nAccept the invitation (valid 7 days):\n${link}\n\nIf you weren't expecting this, you can ignore this email.`);
    return { link, emailed: mail.sent };
  });
  revalidatePath("/settings");
  return r.ok ? { ...r, message: r.data?.emailed ? "Invitation emailed." : "Invitation created. Share the link below." } : r;
}

export async function revokeInvitation(id: string): Promise<ActionResult> {
  const ctx = await requireContext();
  const r = await attempt(() => business.revokeInvitation(ctx, id));
  revalidatePath("/settings");
  return r;
}

export async function updateMember(memberId: string, patch: { role?: string; status?: string }): Promise<ActionResult> {
  const ctx = await requireContext();
  const parsed = z.object({ role: z.enum(MEMBER_ROLES).optional(), status: z.enum(["active", "disabled"]).optional() }).safeParse(patch);
  if (!parsed.success || !/^[A-Za-z0-9]{6,128}$/.test(memberId)) return { ok: false, error: "Invalid change." };
  const r = await attempt(() => business.updateMember(ctx, memberId, parsed.data), "Member updated.");
  revalidatePath("/settings");
  return r;
}

export async function removeMember(memberId: string): Promise<ActionResult> {
  const ctx = await requireContext();
  if (!/^[A-Za-z0-9]{6,128}$/.test(memberId)) return { ok: false, error: "Invalid member." };
  const r = await attempt(() => business.updateMember(ctx, memberId, "remove"), "Removed from the business.");
  revalidatePath("/settings");
  return r;
}

export async function saveLocation(_: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const ctx = await requireContext();
  const parsed = z.object({ name: z.string().trim().min(1).max(120), address: optionalText(500) }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return zodFailure(parsed.error);
  const r = await attempt(() => business.addLocation(ctx, parsed.data.name, parsed.data.address), "Location added.");
  revalidatePath("/settings");
  return r;
}

export async function deleteLocation(id: string): Promise<ActionResult> {
  const ctx = await requireContext();
  const r = await attempt(() => business.deleteLocation(ctx, id));
  revalidatePath("/settings");
  return r;
}

const TYPES = ["low_stock", "out_of_stock", "expiring", "expired", "sync_failed", "po_pending", "ai_review"] as const;

export async function saveNotificationPrefs(_: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const ctx = await requireContext();
  const raw = Object.fromEntries(formData);
  const number = typeof raw.whatsappNumber === "string" ? raw.whatsappNumber.replace(/[\s()-]/g, "") : "";
  if (number && !/^\+?[0-9]{7,15}$/.test(number)) return { ok: false, error: "Enter a WhatsApp number with country code.", fieldErrors: { whatsappNumber: "Digits with country code." } };
  return attempt(() => business.savePrefs(ctx, {
    emailEnabled: raw.email === "on", pushEnabled: raw.push === "on", whatsappEnabled: raw.whatsapp === "on" && !!number, whatsappNumber: number || null,
    types: Object.fromEntries(TYPES.map((t) => [t, raw[`type_${t}`] === "on"])),
  }), "Notification preferences saved.");
}

export async function leaveBusiness(): Promise<ActionResult> {
  const ctx = await requireContext();
  return attempt(() => business.updateMember(ctx, ctx.userId, "remove"), "You left the business.");
}
