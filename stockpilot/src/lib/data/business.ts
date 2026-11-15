import "server-only";
import { createHash, randomBytes } from "node:crypto";
import type { AppContext } from "@/lib/auth/session";
import { AppError, forbidden, invalid } from "@/lib/errors";
import { db } from "@/lib/firebase/admin";
import { newId } from "@/lib/firebase/ids";
import type { MemberRole } from "@/lib/domain/types";
import type { BusinessDoc, MemberDoc, NotificationPrefsDoc } from "./model";
import { logActivity } from "./notify";
import { biz, invitations, memberships, nowIso, users } from "./refs";

const RANK: Record<MemberRole, number> = { employee: 1, manager: 2, owner: 3 };
export function assertRole(ctx: Pick<AppContext, "role">, min: MemberRole, message?: string) {
  if (RANK[ctx.role] < RANK[min]) throw forbidden(message);
}

const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex");

export async function ensureUserProfile(uid: string, email: string | null, fullName: string | null) {
  await users().doc(uid).set({ email, fullName, createdAt: nowIso() }, { merge: true });
}

export async function createBusiness(
  user: { userId: string; email: string | null; fullName: string | null },
  input: { name: string; businessType: string; currency: string; timezone: string; locationName: string },
): Promise<string> {
  const owned = await memberships(user.userId).where("role", "==", "owner").count().get();
  if (owned.data().count >= 10) throw new AppError(429, "limit_reached", "You've reached the maximum number of businesses.");

  const id = newId();
  const ref = biz(id);
  const now = nowIso();
  const business: BusinessDoc = {
    name: input.name, businessType: input.businessType, currency: input.currency, timezone: input.timezone,
    largeAdjustmentUnits: 50, largeAdjustmentPercent: 50, expiryWarningDays: 30, createdBy: user.userId, createdAt: now,
  };
  const batch = db().batch();
  batch.create(ref.doc, business);
  batch.create(ref.members.doc(user.userId), { uid: user.userId, role: "owner", status: "active", email: user.email, fullName: user.fullName, createdAt: now });
  batch.set(memberships(user.userId).doc(id), { businessId: id, businessName: input.name, role: "owner", status: "active" });
  batch.create(ref.locations.doc(newId()), { name: input.locationName || "Main store", address: null, isPrimary: true, createdAt: now });
  await batch.commit();
  await ensureUserProfile(user.userId, user.email, user.fullName);
  await logActivity(id, user.userId, "business.created", "business", id);
  return id;
}

export async function updateBusinessSettings(ctx: AppContext, patch: Partial<Pick<BusinessDoc, "name" | "currency" | "timezone" | "largeAdjustmentUnits" | "largeAdjustmentPercent" | "expiryWarningDays">>) {
  assertRole(ctx, "owner", "Only the owner can change business settings.");
  await biz(ctx.business.id).doc.update(patch);
  if (patch.name) {
    const members = await biz(ctx.business.id).members.get();
    await Promise.all(members.docs.map((m) => memberships(m.id).doc(ctx.business.id).set({ businessName: patch.name! }, { merge: true })));
  }
}

export async function createInvitation(ctx: AppContext, email: string, role: "manager" | "employee"): Promise<string> {
  assertRole(ctx, "owner", "Only the owner can invite people.");
  const open = await invitations().where("businessId", "==", ctx.business.id).where("acceptedAt", "==", null).get();
  if (open.docs.filter((d) => d.data().expiresAt > nowIso()).length >= 50) throw new AppError(429, "limit_reached", "Too many open invitations.");
  const token = randomBytes(32).toString("hex");
  await invitations().doc(tokenHash(token)).create({
    businessId: ctx.business.id, businessName: ctx.business.name, email: email.trim().toLowerCase(), role, invitedBy: ctx.userId,
    expiresAt: new Date(Date.now() + 7 * 86_400_000).toISOString(), acceptedAt: null, acceptedBy: null, createdAt: nowIso(),
  });
  await logActivity(ctx.business.id, ctx.userId, "member.invited", "invitation", null, { email: email.toLowerCase(), role });
  return token;
}

export async function listOpenInvitations(ctx: AppContext) {
  const snap = await invitations().where("businessId", "==", ctx.business.id).where("acceptedAt", "==", null).get();
  const now = nowIso();
  return snap.docs.filter((d) => d.data().expiresAt > now).map((d) => ({ id: d.id, email: d.data().email, role: d.data().role, expiresAt: d.data().expiresAt }));
}

export async function revokeInvitation(ctx: AppContext, id: string) {
  assertRole(ctx, "owner");
  if (!/^[0-9a-f]{64}$/.test(id)) throw invalid("Invalid invitation.");
  const ref = invitations().doc(id);
  const snap = await ref.get();
  if (snap.data()?.businessId !== ctx.business.id) throw forbidden();
  await ref.delete();
}

/** Accept an invitation. Requires a VERIFIED email that matches the invitation. */
export async function acceptInvitation(user: { userId: string; email: string | null; emailVerified: boolean; fullName: string | null }, token: string): Promise<string> {
  if (!/^[0-9a-f]{64}$/.test(token)) throw new AppError(400, "invalid_invitation", "This invitation link is invalid.");
  if (!user.emailVerified) throw new AppError(403, "email_unverified", "Verify your email address first, then open the invitation link again.");
  const ref = invitations().doc(tokenHash(token));
  return db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const inv = snap.data();
    if (!inv || inv.acceptedAt || inv.expiresAt < nowIso()) throw new AppError(400, "invalid_invitation", "This invitation is invalid or has expired. Ask the owner for a new one.");
    if (inv.email !== (user.email ?? "").toLowerCase()) throw new AppError(403, "invitation_email_mismatch", "This invitation was sent to a different email address. Sign in with that email to accept it.");
    const b = biz(inv.businessId);
    const existing = await tx.get(b.members.doc(user.userId));
    const now = nowIso();
    const member: MemberDoc = { uid: user.userId, role: existing.data()?.role === "owner" ? "owner" : inv.role, status: "active", email: user.email, fullName: user.fullName, createdAt: existing.data()?.createdAt ?? now };
    tx.set(b.members.doc(user.userId), member);
    tx.set(memberships(user.userId).doc(inv.businessId), { businessId: inv.businessId, businessName: inv.businessName, role: member.role, status: "active" });
    tx.update(ref, { acceptedAt: now, acceptedBy: user.userId });
    return inv.businessId;
  }).then(async (businessId) => {
    await ensureUserProfile(user.userId, user.email, user.fullName);
    await logActivity(businessId, user.userId, "member.joined", "member", user.userId);
    return businessId;
  });
}

export async function listMembers(ctx: AppContext) {
  const snap = await biz(ctx.business.id).members.orderBy("createdAt").get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

/** Change a member's role or status. Keeps at least one active owner. */
export async function updateMember(ctx: AppContext, uid: string, patch: { role?: MemberRole; status?: "active" | "disabled" } | "remove") {
  const self = uid === ctx.userId;
  if (patch !== "remove" || !self) assertRole(ctx, "owner", "Only the owner can change the team.");
  const ref = biz(ctx.business.id);
  await db().runTransaction(async (tx) => {
    const owners = await tx.get(ref.members.where("role", "==", "owner").where("status", "==", "active"));
    const target = await tx.get(ref.members.doc(uid));
    const t = target.data();
    if (!t) throw invalid("Member not found.");
    const losingOwner = t.role === "owner" && t.status === "active" && (patch === "remove" || (patch.role && patch.role !== "owner") || patch.status === "disabled");
    if (losingOwner && owners.size <= 1) throw new AppError(409, "last_owner", "A business must keep at least one owner.");
    if (patch === "remove") {
      tx.delete(ref.members.doc(uid));
      tx.delete(memberships(uid).doc(ctx.business.id));
    } else {
      tx.update(ref.members.doc(uid), patch);
      tx.set(memberships(uid).doc(ctx.business.id), patch, { merge: true });
    }
  });
  await logActivity(ctx.business.id, ctx.userId, patch === "remove" ? "member.removed" : "member.updated", "member", uid, patch === "remove" ? {} : patch);
}

export async function listLocations(businessId: string) {
  const snap = await biz(businessId).locations.get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary) || a.name.localeCompare(b.name));
}

export async function addLocation(ctx: AppContext, name: string, address: string | null) {
  assertRole(ctx, "manager");
  const dup = await biz(ctx.business.id).locations.where("name", "==", name).limit(1).get();
  if (!dup.empty) throw new AppError(409, "duplicate", "A location with that name already exists.");
  await biz(ctx.business.id).locations.add({ name, address, isPrimary: false, createdAt: nowIso() });
}

export async function deleteLocation(ctx: AppContext, id: string) {
  assertRole(ctx, "manager");
  const ref = biz(ctx.business.id).locations.doc(id);
  const snap = await ref.get();
  if (!snap.exists || snap.data()!.isPrimary) throw invalid("The primary location can't be deleted.");
  await ref.delete();
}

export const DEFAULT_PREFS: NotificationPrefsDoc = {
  emailEnabled: true, pushEnabled: false, whatsappEnabled: false, whatsappNumber: null,
  types: { low_stock: true, out_of_stock: true, expiring: true, expired: true, sync_failed: true, po_pending: true, ai_review: true }, updatedAt: "",
};

export async function getPrefs(businessId: string, uid: string): Promise<NotificationPrefsDoc> {
  return (await biz(businessId).notificationPrefs.doc(uid).get()).data() ?? DEFAULT_PREFS;
}

export async function savePrefs(ctx: AppContext, prefs: Omit<NotificationPrefsDoc, "updatedAt">) {
  await biz(ctx.business.id).notificationPrefs.doc(ctx.userId).set({ ...prefs, updatedAt: nowIso() });
}

export async function updateProfileName(ctx: AppContext, fullName: string) {
  await users().doc(ctx.userId).set({ fullName }, { merge: true });
  const list = await memberships(ctx.userId).get();
  await Promise.all(list.docs.map((m) => biz(m.id).members.doc(ctx.userId).update({ fullName }).catch(() => {})));
}
