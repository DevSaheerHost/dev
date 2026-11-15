"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useState } from "react";
import { createUserWithEmailAndPassword, sendEmailVerification, sendPasswordResetEmail, signInWithEmailAndPassword, updateProfile } from "firebase/auth";
import { acceptInvitation, createBusiness, type FormState } from "@/app/actions/auth";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/feedback";
import { Field, Input, Select } from "@/components/ui/form";
import { clientAuth } from "@/lib/firebase/client";
import { authMessage, startServerSession } from "./firebase-auth";

const initial: FormState = {};
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function Messages({ state }: { state: FormState }) {
  if (state.error) return <Alert tone="critical">{state.error}</Alert>;
  if (state.message) return <Alert tone="success">{state.message}</Alert>;
  return null;
}

export function LoginForm({ next }: { next: string }) {
  const router = useRouter();
  const [state, setState] = useState<FormState>({});
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const email = String(data.get("email") ?? "").trim().toLowerCase();
    const password = String(data.get("password") ?? "");
    const fieldErrors: Record<string, string> = {};
    if (!EMAIL.test(email)) fieldErrors.email = "Enter a valid email address.";
    if (!password) fieldErrors.password = "Enter your password.";
    if (Object.keys(fieldErrors).length) return setState({ fieldErrors });
    setPending(true);
    setState({});
    try {
      const cred = await signInWithEmailAndPassword(clientAuth(), email, password);
      await startServerSession(cred.user);
      router.replace(next);
      router.refresh();
    } catch (err) {
      setState({ error: authMessage(err) });
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
      <Messages state={state} />
      <Field label="Email" htmlFor="email" error={state.fieldErrors?.email}>
        <Input id="email" name="email" type="email" autoComplete="email" required aria-invalid={!!state.fieldErrors?.email} />
      </Field>
      <Field label="Password" htmlFor="password" error={state.fieldErrors?.password}>
        <Input id="password" name="password" type="password" autoComplete="current-password" required aria-invalid={!!state.fieldErrors?.password} />
      </Field>
      <div className="-mt-1 text-right text-sm">
        <Link href="/forgot-password" className="text-primary hover:underline">Forgot password?</Link>
      </div>
      <Button type="submit" size="lg" loading={pending}>Sign in</Button>
    </form>
  );
}

export function SignupForm({ next }: { next: string }) {
  const router = useRouter();
  const [state, setState] = useState<FormState>({});
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const fullName = String(data.get("fullName") ?? "").trim();
    const email = String(data.get("email") ?? "").trim().toLowerCase();
    const password = String(data.get("password") ?? "");
    const fieldErrors: Record<string, string> = {};
    if (fullName.length < 2 || fullName.length > 120) fieldErrors.fullName = "Enter your name.";
    if (!EMAIL.test(email)) fieldErrors.email = "Enter a valid email address.";
    if (password.length < 10) fieldErrors.password = "Use at least 10 characters.";
    if (Object.keys(fieldErrors).length) return setState({ fieldErrors });
    setPending(true);
    setState({});
    try {
      const cred = await createUserWithEmailAndPassword(clientAuth(), email, password);
      await updateProfile(cred.user, { displayName: fullName });
      await sendEmailVerification(cred.user).catch(() => {});
      await startServerSession(cred.user);
      router.replace(next);
      router.refresh();
    } catch (err) {
      setState({ error: authMessage(err) });
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
      <Messages state={state} />
      <Field label="Your name" htmlFor="fullName" error={state.fieldErrors?.fullName}>
        <Input id="fullName" name="fullName" autoComplete="name" required aria-invalid={!!state.fieldErrors?.fullName} />
      </Field>
      <Field label="Work email" htmlFor="email" error={state.fieldErrors?.email}>
        <Input id="email" name="email" type="email" autoComplete="email" required aria-invalid={!!state.fieldErrors?.email} />
      </Field>
      <Field label="Password" htmlFor="password" hint="At least 10 characters." error={state.fieldErrors?.password}>
        <Input id="password" name="password" type="password" autoComplete="new-password" minLength={10} required aria-invalid={!!state.fieldErrors?.password} />
      </Field>
      <Button type="submit" size="lg" loading={pending}>Create account</Button>
      <p className="text-center text-xs text-muted">We&apos;ll send a link to verify your email. You need it to join a team.</p>
    </form>
  );
}

export function ForgotPasswordForm() {
  const [state, setState] = useState<FormState>({});
  const [pending, setPending] = useState(false);
  return (
    <form
      className="flex flex-col gap-4"
      noValidate
      onSubmit={async (e) => {
        e.preventDefault();
        const email = String(new FormData(e.currentTarget).get("email") ?? "").trim().toLowerCase();
        if (!EMAIL.test(email)) return setState({ fieldErrors: { email: "Enter a valid email address." } });
        setPending(true);
        // Same message whether or not the account exists.
        await sendPasswordResetEmail(clientAuth(), email).catch(() => {});
        setState({ message: "If an account exists for that email, a reset link is on its way." });
        setPending(false);
      }}
    >
      <Messages state={state} />
      <Field label="Email" htmlFor="email" error={state.fieldErrors?.email}>
        <Input id="email" name="email" type="email" autoComplete="email" required />
      </Field>
      <Button type="submit" size="lg" loading={pending}>Send reset link</Button>
    </form>
  );
}

const CURRENCIES = ["USD", "EUR", "GBP", "CAD", "AUD", "INR", "AED", "SGD", "NZD", "ZAR", "MXN", "BRL", "JPY"];
const TYPES = [
  ["retail", "Independent retail"], ["grocery", "Grocery"], ["pharmacy", "Pharmacy"],
  ["hardware", "Hardware"], ["convenience", "Convenience store"], ["other", "Other"],
] as const;

export function CreateBusinessForm({ defaultTimezone }: { defaultTimezone: string }) {
  const [state, action, pending] = useActionState(createBusiness, initial);
  const zones = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [defaultTimezone];
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <Messages state={state} />
      <Field label="Store name" htmlFor="name" error={state.fieldErrors?.name}>
        <Input id="name" name="name" required placeholder="e.g. Corner Pharmacy" aria-invalid={!!state.fieldErrors?.name} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Type of store" htmlFor="businessType">
          <Select id="businessType" name="businessType" defaultValue="retail">
            {TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </Select>
        </Field>
        <Field label="Currency" htmlFor="currency" error={state.fieldErrors?.currency}>
          <Select id="currency" name="currency" defaultValue="USD">
            {CURRENCIES.map((c) => <option key={c}>{c}</option>)}
          </Select>
        </Field>
      </div>
      <Field label="Time zone" htmlFor="timezone" hint="Used for expiry dates and daily reports." error={state.fieldErrors?.timezone}>
        <Select id="timezone" name="timezone" defaultValue={defaultTimezone}>
          {zones.map((z) => <option key={z}>{z}</option>)}
        </Select>
      </Field>
      <Field label="First location" htmlFor="locationName" hint="You can add more locations later.">
        <Input id="locationName" name="locationName" defaultValue="Main store" />
      </Field>
      <Button type="submit" size="lg" loading={pending}>Create my store</Button>
    </form>
  );
}

export function AcceptInviteForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState(acceptInvitation, initial);
  return (
    <form action={action} className="flex flex-col gap-4">
      <Messages state={state} />
      <input type="hidden" name="token" value={token} />
      <Button type="submit" size="lg" loading={pending}>Join the team</Button>
    </form>
  );
}
