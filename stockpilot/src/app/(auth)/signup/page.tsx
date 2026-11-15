import Link from "next/link";
import { SignupForm } from "@/components/auth/forms";
import { safeNextPath } from "@/lib/auth/redirect";

export const metadata = { title: "Create account" };

export default async function SignupPage({ searchParams }: PageProps<"/signup">) {
  const next = safeNextPath((await searchParams).next, "/onboarding");
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Create your account</h1>
      <p className="mb-6 mt-1 text-sm text-muted">Set up your store in under two minutes.</p>
      <SignupForm next={next} />
      <p className="mt-6 text-center text-sm text-muted">
        Already have an account? <Link href={`/login?next=${encodeURIComponent(next)}`} className="font-medium text-primary hover:underline">Sign in</Link>
      </p>
    </>
  );
}
