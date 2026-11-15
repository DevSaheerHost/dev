"use server";
import { revalidatePath } from "next/cache";
import { requireContext } from "@/lib/auth/session";
import { db } from "@/lib/firebase/admin";
import { biz, nowIso } from "@/lib/data/refs";

export async function markAllRead() {
  const ctx = await requireContext();
  const snap = await biz(ctx.business.id).notifications.where("userId", "==", ctx.userId).where("readAt", "==", null).limit(500).get();
  const batch = db().batch();
  for (const d of snap.docs) batch.update(d.ref, { readAt: nowIso() });
  await batch.commit();
  revalidatePath("/", "layout");
}
