"use client";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState, useTransition } from "react";
import { BellRing, Copy, LogOut, Trash2, UserPlus } from "lucide-react";
import { deleteLocation, inviteMember, leaveBusiness, removeMember, revokeInvitation, saveLocation, saveNotificationPrefs, updateBusiness, updateMember, updateProfile } from "@/app/(app)/settings/actions";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Alert } from "@/components/ui/feedback";
import { Field, Input, Select } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import type { ActionResult } from "@/lib/actions";

function useResultToast(state: ActionResult<unknown> | null) {
  const toast = useToast();
  const router = useRouter();
  useEffect(() => {
    if (state?.ok) {
      if (state.message) toast({ tone: "success", title: state.message });
      router.refresh();
    }
  }, [state, toast, router]);
}

export function ProfileForm({ fullName }: { fullName: string }) {
  const [state, action, pending] = useActionState(updateProfile, null);
  useResultToast(state);
  return (
    <form action={action} className="flex flex-col gap-3 sm:flex-row sm:items-end">
      <Field label="Your name" htmlFor="fullName" className="flex-1" error={state && !state.ok ? state.fieldErrors?.fullName : null}><Input id="fullName" name="fullName" defaultValue={fullName} required /></Field>
      <Button type="submit" variant="secondary" loading={pending}>Save</Button>
    </form>
  );
}

export function BusinessForm({ values, zones }: { values: { name: string; currency: string; timezone: string; largeAdjustmentUnits: number; largeAdjustmentPercent: number; expiryWarningDays: number }; zones: string[] }) {
  const [state, action, pending] = useActionState(updateBusiness, null);
  useResultToast(state);
  const fe = state && !state.ok ? state.fieldErrors ?? {} : {};
  return (
    <form action={action} className="grid gap-4 sm:grid-cols-2">
      {state && !state.ok && <Alert tone="critical" className="sm:col-span-2">{state.error}</Alert>}
      <Field label="Business name" htmlFor="b-name" error={fe.name}><Input id="b-name" name="name" defaultValue={values.name} required /></Field>
      <Field label="Currency" htmlFor="b-cur" error={fe.currency}><Input id="b-cur" name="currency" defaultValue={values.currency} maxLength={3} className="uppercase" /></Field>
      <Field label="Time zone" htmlFor="b-tz" error={fe.timezone}>
        <Select id="b-tz" name="timezone" defaultValue={values.timezone}>{zones.map((z) => <option key={z}>{z}</option>)}</Select>
      </Field>
      <Field label="Expiry warning (days)" htmlFor="b-exp" error={fe.expiryWarningDays}><Input id="b-exp" name="expiryWarningDays" type="number" min={1} max={365} defaultValue={values.expiryWarningDays} /></Field>
      <Field label="Large change: more than (units)" htmlFor="b-units" hint="Employees need a manager to approve bigger changes." error={fe.largeAdjustmentUnits}><Input id="b-units" name="largeAdjustmentUnits" type="number" min={1} step="any" defaultValue={values.largeAdjustmentUnits} /></Field>
      <Field label="…or more than (% of stock)" htmlFor="b-pct" error={fe.largeAdjustmentPercent}><Input id="b-pct" name="largeAdjustmentPercent" type="number" min={1} step="any" defaultValue={values.largeAdjustmentPercent} /></Field>
      <div className="flex justify-end sm:col-span-2"><Button type="submit" loading={pending}>Save settings</Button></div>
    </form>
  );
}

export function InviteForm() {
  const [state, action, pending] = useActionState(inviteMember, null);
  const toast = useToast();
  useResultToast(state);
  return (
    <div className="space-y-3">
      <form action={action} className="grid gap-3 sm:grid-cols-[1fr_160px_auto] sm:items-end">
        <Field label="Email" htmlFor="inv-email" error={state && !state.ok ? state.fieldErrors?.email : null}><Input id="inv-email" name="email" type="email" required placeholder="name@example.com" /></Field>
        <Field label="Role" htmlFor="inv-role"><Select id="inv-role" name="role" defaultValue="employee"><option value="employee">Employee</option><option value="manager">Manager</option></Select></Field>
        <Button type="submit" loading={pending}><UserPlus /> Invite</Button>
      </form>
      {state && !state.ok && !state.fieldErrors && <Alert tone="critical">{state.error}</Alert>}
      {state?.ok && state.data && (
        <Alert tone="success" title={state.data.emailed ? "Invitation emailed" : "Share this invitation link"}>
          <div className="mt-1 flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded bg-surface px-2 py-1 text-xs">{state.data.link}</code>
            <Button size="sm" variant="outline" onClick={async () => { await navigator.clipboard.writeText(state.data!.link); toast({ tone: "success", title: "Link copied" }); }}><Copy /> Copy</Button>
          </div>
          <p className="mt-1 text-xs">The link works once and expires in 7 days. It&apos;s only valid for that email address.</p>
        </Alert>
      )}
    </div>
  );
}

export function MemberRow({ member, isOwner, isSelf }: { member: { id: string; name: string; email: string | null; role: string; status: string }; isOwner: boolean; isSelf: boolean }) {
  const [pending, start] = useTransition();
  const toast = useToast();
  const router = useRouter();
  const run = (fn: () => Promise<ActionResult>) => start(async () => {
    const r = await fn();
    toast(r.ok ? { tone: "success", title: r.message ?? "Updated" } : { tone: "error", title: r.error });
    router.refresh();
  });
  return (
    <li className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{member.name}{isSelf && <span className="text-muted"> (you)</span>}</p>
        <p className="truncate text-xs text-muted">{member.email}</p>
      </div>
      {isOwner && !isSelf ? (
        <>
          <Select aria-label="Role" value={member.role} disabled={pending} onChange={(e) => run(() => updateMember(member.id, { role: e.target.value }))} className="h-8 w-32">
            <option value="employee">Employee</option><option value="manager">Manager</option><option value="owner">Owner</option>
          </Select>
          <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => updateMember(member.id, { status: member.status === "active" ? "disabled" : "active" }))}>
            {member.status === "active" ? "Disable" : "Enable"}
          </Button>
          <ConfirmDialog trigger={<button className="rounded p-1 text-muted hover:text-critical" aria-label="Remove member"><Trash2 className="size-4" /></button>} title={`Remove ${member.name}?`} description="They lose access immediately. Their past changes stay in the audit log." confirmLabel="Remove" tone="destructive" onConfirm={() => run(() => removeMember(member.id))} />
        </>
      ) : (
        <span className="capitalize text-muted">{member.role}{member.status !== "active" && " · disabled"}</span>
      )}
    </li>
  );
}

export function RevokeInviteButton({ id }: { id: string }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  return <Button size="sm" variant="ghost" loading={pending} onClick={() => start(async () => { await revokeInvitation(id); router.refresh(); })}>Revoke</Button>;
}

export function LocationForm() {
  const [state, action, pending] = useActionState(saveLocation, null);
  useResultToast(state);
  return (
    <form action={action} className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
      <Field label="Location name" htmlFor="loc-name"><Input id="loc-name" name="name" required placeholder="Back room" /></Field>
      <Field label="Address (optional)" htmlFor="loc-addr"><Input id="loc-addr" name="address" /></Field>
      <Button type="submit" variant="secondary" loading={pending}>Add</Button>
      {state && !state.ok && <Alert tone="critical" className="sm:col-span-3">{state.error}</Alert>}
    </form>
  );
}

export function DeleteLocationButton({ id }: { id: string }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  return <button disabled={pending} onClick={() => start(async () => { await deleteLocation(id); router.refresh(); })} className="rounded p-1 text-muted hover:text-critical" aria-label="Delete location"><Trash2 className="size-4" /></button>;
}

const TYPE_LABELS: Record<string, string> = {
  low_stock: "Low stock", out_of_stock: "Out of stock", expiring: "Expiring soon", expired: "Expired stock",
  sync_failed: "POS sync failures", po_pending: "Purchase orders awaiting approval", ai_review: "AI changes needing approval",
};

function urlBase64ToUint8Array(base64: string) {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

export function NotificationPrefsForm({ prefs, vapidKey }: { prefs: { email: boolean; push: boolean; whatsapp: boolean; whatsappNumber: string; types: Record<string, boolean> }; vapidKey: string | null }) {
  const [state, action, pending] = useActionState(saveNotificationPrefs, null);
  const [pushState, setPushState] = useState<"idle" | "on" | "denied" | "unsupported">("idle");
  const toast = useToast();
  useResultToast(state);

  async function enablePush() {
    if (!("serviceWorker" in navigator) || !("PushManager" in window) || !vapidKey) return setPushState("unsupported");
    const permission = await Notification.requestPermission();
    if (permission !== "granted") return setPushState("denied");
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(vapidKey) });
    const res = await fetch("/api/push/subscribe", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(sub.toJSON()) });
    if (res.ok) {
      setPushState("on");
      toast({ tone: "success", title: "Push notifications enabled on this device" });
    }
  }

  return (
    <form action={action} className="space-y-5">
      {state && !state.ok && <Alert tone="critical">{state.error}</Alert>}
      <fieldset className="space-y-2">
        <legend className="mb-1 text-sm font-semibold">Channels</legend>
        <p className="text-xs text-muted">In-app notifications are always on.</p>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="email" defaultChecked={prefs.email} className="size-4 accent-[var(--primary)]" /> Email digest</label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="push" defaultChecked={prefs.push} className="size-4 accent-[var(--primary)]" /> Push notifications</label>
        <div className="pl-6">
          {pushState === "on" ? <p className="text-xs text-success">Enabled on this device.</p>
            : pushState === "denied" ? <p className="text-xs text-warning">Notifications are blocked in this browser&apos;s settings.</p>
            : pushState === "unsupported" ? <p className="text-xs text-muted">Not available here. On iPhone, add StockPilot to your Home Screen first.</p>
            : <Button type="button" size="sm" variant="outline" onClick={enablePush} disabled={!vapidKey}><BellRing /> Enable on this device</Button>}
        </div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="whatsapp" defaultChecked={prefs.whatsapp} className="size-4 accent-[var(--primary)]" /> WhatsApp for urgent alerts (out of stock, expired, sync failures)</label>
        <div className="pl-6"><Input name="whatsappNumber" defaultValue={prefs.whatsappNumber} placeholder="+15550102030" aria-label="WhatsApp number" className="max-w-xs" /></div>
      </fieldset>
      <fieldset className="space-y-2">
        <legend className="mb-1 text-sm font-semibold">Alert types</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {Object.entries(TYPE_LABELS).map(([k, label]) => (
            <label key={k} className="flex items-center gap-2 text-sm"><input type="checkbox" name={`type_${k}`} defaultChecked={prefs.types[k] !== false} className="size-4 accent-[var(--primary)]" /> {label}</label>
          ))}
        </div>
      </fieldset>
      <div className="flex justify-end"><Button type="submit" loading={pending}>Save preferences</Button></div>
    </form>
  );
}

export function LeaveBusinessButton({ name }: { name: string }) {
  const router = useRouter();
  const toast = useToast();
  return (
    <ConfirmDialog
      trigger={<Button variant="ghost" className="text-critical"><LogOut /> Leave {name}</Button>}
      title={`Leave ${name}?`}
      description="You'll lose access to this business. An owner can invite you again."
      confirmLabel="Leave"
      tone="destructive"
      onConfirm={async () => {
        const r = await leaveBusiness();
        if (r.ok) router.push("/");
        else toast({ tone: "error", title: r.error });
      }}
    />
  );
}
