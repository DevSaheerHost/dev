import Link from "next/link";
import { AcceptInviteForm } from "@/components/auth/forms";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { resolveContext } from "@/lib/auth/session";

export const metadata = { title: "Join a store" };

export default async function InvitePage({ params }: PageProps<"/invite/[token]">) {
  const { token } = await params;
  const valid = /^[0-9a-f]{64}$/.test(token);
  const ctx = await resolveContext();
  const next = `/invite/${token}`;
  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-4">
      <Card>
        <CardBody className="space-y-4">
          <h1 className="text-xl font-semibold">You&apos;ve been invited to StockPilot</h1>
          {!valid ? (
            <p className="text-sm text-muted">This invitation link is malformed. Ask the store owner to send a new one.</p>
          ) : ctx.status === "unauthenticated" ? (
            <>
              <p className="text-sm text-muted">Sign in or create an account with the email address the invitation was sent to.</p>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Button asChild className="flex-1"><Link href={`/signup?next=${encodeURIComponent(next)}`}>Create account</Link></Button>
                <Button asChild variant="outline" className="flex-1"><Link href={`/login?next=${encodeURIComponent(next)}`}>Sign in</Link></Button>
              </div>
            </>
          ) : !(ctx.status === "ok" ? ctx.context.emailVerified : ctx.emailVerified) ? (
            <>
              <p className="text-sm text-muted">
                Verify your email address first: open the link we sent to {ctx.status === "ok" ? ctx.context.email : ctx.email}. Then sign in again and reopen this invitation.
              </p>
              <Button asChild variant="outline"><Link href={`/login?next=${encodeURIComponent(next)}`}>I&apos;ve verified — sign in again</Link></Button>
            </>
          ) : (
            <>
              <p className="text-sm text-muted">Accept to join the team as {ctx.status === "ok" ? ctx.context.email : ctx.email}.</p>
              <AcceptInviteForm token={token} />
            </>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
