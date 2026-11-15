"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireContext } from "@/lib/auth/session";

export async function markRead(ids: string[] | "all") {
  const ctx = await requireContext();
  let q = ctx.supabase.from("notifications").update({ read_at: new Date().toISOString() }).eq("user_id", ctx.userId).eq("business_id", ctx.business.id).is("read_at", null);
  if (ids !== "all") {
    const parsed = z.array(z.uuid()).max(200).safeParse(ids);
    if (!parsed.success) return;
    q = q.in("id", parsed.data);
  }
  await q;
  revalidatePath("/", "layout");
}
