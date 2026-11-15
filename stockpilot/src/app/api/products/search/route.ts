import { NextResponse } from "next/server";
import { authedRoute, fromDbError } from "@/lib/api/handler";

/** Product picker search (RLS-scoped trigram search). */
export const GET = authedRoute({ rateLimit: { name: "search", limit: 300, windowSeconds: 60 } }, async (request, ctx) => {
  const q = (request.nextUrl.searchParams.get("q") ?? "").trim().slice(0, 100);
  if (q.length === 0) {
    const { data, error } = await ctx.supabase
      .from("products")
      .select("id, name, sku, unit, current_quantity")
      .eq("business_id", ctx.business.id)
      .is("archived_at", null)
      .order("name")
      .limit(20);
    if (error) throw fromDbError(error);
    return NextResponse.json({ products: data });
  }
  const { data, error } = await ctx.supabase.rpc("search_products", { p_business_id: ctx.business.id, p_query: q, p_limit: 20 });
  if (error) throw fromDbError(error);
  return NextResponse.json({ products: (data ?? []).filter((p: { score: number }) => p.score > 0.1) });
});
