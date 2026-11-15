import "server-only";
import type { AppContext } from "@/lib/auth/session";

export async function productFormOptions(ctx: AppContext) {
  const [suppliers, locations, categories] = await Promise.all([
    ctx.supabase.from("suppliers").select("id, name").eq("business_id", ctx.business.id).is("archived_at", null).order("name"),
    ctx.supabase.from("business_locations").select("id, name").eq("business_id", ctx.business.id).order("name"),
    ctx.supabase.from("product_categories").select("name").eq("business_id", ctx.business.id).order("name"),
  ]);
  return {
    suppliers: suppliers.data ?? [],
    locations: locations.data ?? [],
    categories: (categories.data ?? []).map((c) => c.name as string),
  };
}
