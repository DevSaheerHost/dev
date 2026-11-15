import "server-only";
import type { AppContext } from "@/lib/auth/session";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/**
 * When the database refuses an employee's change as too large, route the
 * suggestion to managers instead of dropping it. Ownership is verified
 * before the privileged update.
 */
export async function escalateReviewItem(ctx: AppContext, itemId: string): Promise<boolean> {
  const { data: item } = await ctx.supabase
    .from("ai_review_queue")
    .select("id, business_id, created_by, status, spoken_product")
    .eq("id", itemId)
    .maybeSingle();
  if (!item || item.business_id !== ctx.business.id || item.created_by !== ctx.userId) return false;
  if (!["pending", "needs_clarification"].includes(item.status)) return false;

  const admin = createSupabaseAdminClient();
  const { error } = await admin
    .from("ai_review_queue")
    .update({ requires_role: "manager", risk_level: "high" })
    .eq("id", itemId)
    .eq("business_id", ctx.business.id);
  if (error) {
    console.error("Escalation failed", error.message);
    return false;
  }
  const { data: managers } = await admin
    .from("business_members")
    .select("user_id")
    .eq("business_id", ctx.business.id)
    .eq("status", "active")
    .in("role", ["owner", "manager"]);
  // The dedupe index is partial, so insert row by row and ignore duplicates.
  for (const m of managers ?? []) {
    const { error: notifyError } = await admin.from("notifications").insert({
      business_id: ctx.business.id,
      user_id: m.user_id,
      type: "ai_review",
      severity: "info",
      title: "AI change needs approval",
      body: `${item.spoken_product ?? "An inventory change"} — review before it is applied.`,
      link: "/review",
      dedupe_key: `ai_review:${itemId}`,
    });
    if (notifyError && notifyError.code !== "23505") console.error("Notification insert failed", notifyError.message);
  }
  return true;
}
