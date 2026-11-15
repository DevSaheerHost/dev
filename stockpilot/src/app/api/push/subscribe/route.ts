import { NextResponse } from "next/server";
import { z } from "zod";
import { authedRoute, readJson } from "@/lib/api/handler";
import { nowIso, pushSubscriptions } from "@/lib/data/refs";
import { hashId } from "@/lib/firebase/ids";

const schema = z.object({
  endpoint: z.url().startsWith("https://").max(1000),
  keys: z.object({ p256dh: z.string().min(10).max(200), auth: z.string().min(8).max(100) }),
});

export const POST = authedRoute({ rateLimit: { name: "push-sub", limit: 20, windowSeconds: 3600 } }, async (request, ctx) => {
  const sub = await readJson(request, schema);
  await pushSubscriptions(ctx.userId).doc(hashId(sub.endpoint)).set({ endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth, createdAt: nowIso() });
  return NextResponse.json({ ok: true });
});

export const DELETE = authedRoute({}, async (request, ctx) => {
  const { endpoint } = await readJson(request, z.object({ endpoint: z.url().max(1000) }));
  await pushSubscriptions(ctx.userId).doc(hashId(endpoint)).delete();
  return NextResponse.json({ ok: true });
});
