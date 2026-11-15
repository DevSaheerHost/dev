import { redirect } from "next/navigation";
import { ResetPasswordForm } from "@/components/auth/forms";
import { resolveContext } from "@/lib/auth/session";

export const metadata = { title: "Choose a new password" };

export default async function ResetPage() {
  if ((await resolveContext()).status === "unauthenticated") redirect("/login?error=link");
  return (
    <div className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-5">
      <h1 className="text-2xl font-semibold tracking-tight">Choose a new password</h1>
      <p className="mb-6 mt-1 text-sm text-muted">You&apos;re signed in from the reset link.</p>
      <ResetPasswordForm />
    </div>
  );
}
