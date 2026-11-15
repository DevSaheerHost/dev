import { redirect } from "next/navigation";
import { CreateBusinessForm } from "@/components/auth/forms";
import { Card, CardBody } from "@/components/ui/card";
import { resolveContext } from "@/lib/auth/session";

export const metadata = { title: "Set up your store" };

export default async function OnboardingPage() {
  const ctx = await resolveContext();
  if (ctx.status === "unauthenticated") redirect("/login?next=/onboarding");
  const firstTime = ctx.status === "no_business";
  return (
    <div className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center px-4 py-10">
      <div className="mb-6 flex items-center gap-2.5">
        <span className="flex size-10 items-center justify-center rounded-xl bg-primary font-bold text-primary-foreground">SP</span>
        <p className="font-semibold">StockPilot AI</p>
      </div>
      <h1 className="text-2xl font-semibold tracking-tight">{firstTime ? "Set up your store" : "Add another business"}</h1>
      <p className="mb-6 mt-1 text-sm text-muted">
        You&apos;ll be the owner. Invite managers and employees afterwards from Settings. Joining an existing store? Open the invitation link you were sent.
      </p>
      <Card>
        <CardBody>
          <CreateBusinessForm defaultTimezone="UTC" />
        </CardBody>
      </Card>
    </div>
  );
}
