import { MapPin } from "lucide-react";
import { BusinessForm, DeleteLocationButton, InviteForm, LeaveBusinessButton, LocationForm, MemberRow, NotificationPrefsForm, ProfileForm, RevokeInviteButton } from "@/components/settings/settings-forms";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page";
import { hasRole, requireContext } from "@/lib/auth/session";
import { publicEnv } from "@/lib/env";
import { formatDate } from "@/lib/utils";
import { getPrefs, listLocations, listMembers, listOpenInvitations } from "@/lib/data/business";

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  const ctx = await requireContext();
  const owner = ctx.role === "owner";
  const manager = hasRole(ctx.role, "manager");
  const [members, invites, locations, prefs] = await Promise.all([
    listMembers(ctx),
    owner ? listOpenInvitations(ctx) : Promise.resolve([]),
    listLocations(ctx.business.id),
    getPrefs(ctx.business.id, ctx.userId),
  ]);
  const zones = Intl.supportedValuesOf("timeZone");

  return (
    <>
      <PageHeader title="Settings" description={`${ctx.business.name} · signed in as ${ctx.role}`} />
      <div className="mx-auto max-w-3xl space-y-6">
        <Card>
          <CardHeader title="Your profile" description={ctx.email ?? undefined} />
          <CardBody><ProfileForm fullName={ctx.fullName ?? ""} /></CardBody>
        </Card>

        {owner && (
          <Card>
            <CardHeader title="Business & inventory rules" />
            <CardBody>
              <BusinessForm zones={zones} values={{ name: ctx.business.name, currency: ctx.business.currency, timezone: ctx.business.timezone, largeAdjustmentUnits: ctx.business.largeAdjustmentUnits, largeAdjustmentPercent: ctx.business.largeAdjustmentPercent, expiryWarningDays: ctx.business.expiryWarningDays }} />
            </CardBody>
          </Card>
        )}

        <Card>
          <CardHeader title="Team" description="Owners manage everything; managers manage stock and suppliers; employees audit and report." />
          <ul className="divide-y divide-border">
            {members.map((m) => (
              <MemberRow key={m.id} isOwner={owner} isSelf={m.id === ctx.userId} member={{ id: m.id, name: m.fullName || m.email || "Member", email: m.email, role: m.role, status: m.status }} />
            ))}
          </ul>
          {owner && (
            <CardBody className="space-y-4 border-t border-border">
              <InviteForm />
              {invites.length > 0 && (
                <ul className="space-y-1 text-sm">
                  {invites.map((i) => (
                    <li key={i.id} className="flex items-center justify-between gap-2 rounded-lg bg-surface-muted/60 px-3 py-1.5">
                      <span className="truncate">{i.email} <Badge className="ml-1 capitalize">{i.role}</Badge></span>
                      <span className="flex items-center gap-2 text-xs text-muted">expires {formatDate(i.expiresAt)} <RevokeInviteButton id={i.id} /></span>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          )}
        </Card>

        <Card>
          <CardHeader title="Locations" />
          <ul className="divide-y divide-border">
            {locations.map((l) => (
              <li key={l.id} className="flex items-center gap-3 px-5 py-3 text-sm">
                <MapPin className="size-4 text-muted" />
                <span className="flex-1"><span className="font-medium">{l.name}</span>{l.address && <span className="text-muted"> · {l.address}</span>}</span>
                {l.isPrimary ? <Badge>Primary</Badge> : manager && <DeleteLocationButton id={l.id} />}
              </li>
            ))}
          </ul>
          {manager && <CardBody className="border-t border-border"><LocationForm /></CardBody>}
        </Card>

        <Card id="notifications">
          <CardHeader title="Notifications" />
          <CardBody>
            <NotificationPrefsForm
              vapidKey={publicEnv().NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? null}
              prefs={{ email: prefs.emailEnabled, push: prefs.pushEnabled, whatsapp: prefs.whatsappEnabled, whatsappNumber: prefs.whatsappNumber ?? "", types: prefs.types }}
            />
          </CardBody>
        </Card>

        {!owner && (
          <Card>
            <CardBody className="flex justify-end"><LeaveBusinessButton name={ctx.business.name} /></CardBody>
          </Card>
        )}
      </div>
    </>
  );
}
