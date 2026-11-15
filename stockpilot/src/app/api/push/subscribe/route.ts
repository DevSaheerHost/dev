import { NextResponse } from "next/server";
import { z } from "zod";
import { authedRoute, fromDbError, readJson } from "@/lib/api/handler";

const schema = z.object({
  endpoint: z.url().startsWith("https://").max(1000),
  keys: z.object({ p256dh: z.string().min(10).max(200), auth: z.string().min(8).max(100) }),
});

export const POST = authedRoute({ rateLimit: { name: "push-sub", limit: 20, windowSeconds: 3600 } }, async (request, ctx) => {
  const sub = await readJson(request, schema);
  await ctx.supabase.from("push_subscriptions").delete().eq("endpoint", sub.endpoint).eq("user_id", ctx.userId);
  const { error } = await ctx.supabase.from("push_subscriptions").insert({ user_id: ctx.userId, endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth });
  if (error) throw fromDbError(error);
  return NextResponse.json({ ok: true });
});

export const DELETE = authedRoute({}, async (request, ctx) => {
  const { endpoint } = await readJson(request, z.object({ endpoint: z.url().max(1000) }));
  await ctx.supabase.from("push_subscriptions").delete().eq("endpoint", endpoint).eq("user_id", ctx.userId);
  return NextResponse.json({ ok: true });
});
