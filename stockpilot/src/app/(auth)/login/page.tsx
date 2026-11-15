import Link from "next/link";
import { LoginForm } from "@/components/auth/forms";
import { Alert } from "@/components/ui/feedback";
import { safeNextPath } from "@/lib/auth/redirect";

export const metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const sp = await searchParams;
  const next = safeNextPath(sp.next);
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Welcome back</h1>
      <p className="mb-6 mt-1 text-sm text-muted">Sign in to your store.</p>
      {sp.error === "link" && <Alert tone="warning" className="mb-4">That link has expired or was already used. Please sign in.</Alert>}
      <LoginForm next={next} />
      <p className="mt-6 text-center text-sm text-muted">
        New to StockPilot? <Link href={`/signup?next=${encodeURIComponent(next === "/dashboard" ? "/onboarding" : next)}`} className="font-medium text-primary hover:underline">Create an account</Link>
      </p>
    </>
  );
}
