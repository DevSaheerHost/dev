"use client";
import Link from "next/link";
import { useActionState } from "react";
import { acceptInvitation, createBusiness, login, requestPasswordReset, signup, updatePassword, type FormState } from "@/app/actions/auth";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/feedback";
import { Field, Input, Select } from "@/components/ui/form";

const initial: FormState = {};

function Messages({ state }: { state: FormState }) {
  if (state.error) return <Alert tone="critical">{state.error}</Alert>;
  if (state.message) return <Alert tone="success">{state.message}</Alert>;
  return null;
}

export function LoginForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState(login, initial);
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <Messages state={state} />
      <input type="hidden" name="next" value={next} />
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
  const [state, action, pending] = useActionState(signup, initial);
  if (state.message) return <Alert tone="success" title="Almost there">{state.message}</Alert>;
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <Messages state={state} />
      <input type="hidden" name="next" value={next} />
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
    </form>
  );
}

export function ForgotPasswordForm() {
  const [state, action, pending] = useActionState(requestPasswordReset, initial);
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <Messages state={state} />
      <Field label="Email" htmlFor="email" error={state.fieldErrors?.email}>
        <Input id="email" name="email" type="email" autoComplete="email" required />
      </Field>
      <Button type="submit" size="lg" loading={pending}>Send reset link</Button>
    </form>
  );
}

export function ResetPasswordForm() {
  const [state, action, pending] = useActionState(updatePassword, initial);
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <Messages state={state} />
      <Field label="New password" htmlFor="password" hint="At least 10 characters." error={state.fieldErrors?.password}>
        <Input id="password" name="password" type="password" autoComplete="new-password" minLength={10} required />
      </Field>
      <Button type="submit" size="lg" loading={pending}>Save password</Button>
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
