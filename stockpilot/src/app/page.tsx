import { redirect } from "next/navigation";
import { resolveContext } from "@/lib/auth/session";

export default async function Home() {
  const ctx = await resolveContext();
  redirect(ctx.status === "ok" ? "/dashboard" : ctx.status === "no_business" ? "/onboarding" : "/login");
}
