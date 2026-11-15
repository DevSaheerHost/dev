/** Helpers for tests that run against the Firebase emulators. */
import { biz, memberships } from "@/lib/data/refs";
import type { AppContext } from "@/lib/auth/session";
import type { MemberRole } from "@/lib/domain/types";
import { adminAuth, db } from "@/lib/firebase/admin";

export function requireEmulators() {
  if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST) {
    throw new Error("Run with `npm run test:firebase` (starts the Firestore and Auth emulators).");
  }
  process.env.FIREBASE_PROJECT_ID ??= "demo-stockpilot";
  process.env.GCLOUD_PROJECT ??= "demo-stockpilot";
}

export async function clearFirestore() {
  const project = process.env.FIREBASE_PROJECT_ID ?? "demo-stockpilot";
  await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${project}/databases/(default)/documents`, { method: "DELETE" });
}

export async function createAuthUser(email: string, name: string, verified = true) {
  const u = await adminAuth().createUser({ email, password: "correct-horse-battery", displayName: name, emailVerified: verified });
  return { userId: u.uid, email, emailVerified: verified, fullName: name };
}

/** Builds the same AppContext the server would after verifying a session. */
export async function contextFor(userId: string, businessId: string): Promise<AppContext> {
  const [member, business, list] = await Promise.all([biz(businessId).members.doc(userId).get(), biz(businessId).doc.get(), memberships(userId).get()]);
  const m = member.data();
  const b = business.data();
  if (!m || !b) throw new Error(`${userId} is not a member of ${businessId}`);
  return {
    userId, email: m.email, emailVerified: true, fullName: m.fullName, role: m.role as MemberRole,
    memberships: list.docs.map((d) => ({ businessId: d.id, businessName: d.data().businessName, role: d.data().role })),
    business: { id: businessId, name: b.name, businessType: b.businessType, currency: b.currency, timezone: b.timezone, largeAdjustmentUnits: b.largeAdjustmentUnits, largeAdjustmentPercent: b.largeAdjustmentPercent, expiryWarningDays: b.expiryWarningDays },
  };
}

export { db };
