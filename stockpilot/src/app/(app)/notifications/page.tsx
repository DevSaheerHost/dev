import Link from "next/link";
import { AlertTriangle, Bell, CalendarClock, ClipboardList, PackageX, Plug, Sparkles, TrendingDown } from "lucide-react";
import { MarkAllRead } from "@/components/settings/mark-read";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/feedback";
import { PageHeader } from "@/components/ui/page";
import { requireContext } from "@/lib/auth/session";
import { cn, relativeTime } from "@/lib/utils";
import { biz } from "@/lib/data/refs";

export const metadata = { title: "Notifications" };
const ICON = { low_stock: TrendingDown, out_of_stock: PackageX, expiring: CalendarClock, expired: AlertTriangle, sync_failed: Plug, po_pending: ClipboardList, ai_review: Sparkles, system: Bell } as const;

export default async function NotificationsPage() {
  const ctx = await requireContext();
  const snap = await biz(ctx.business.id).notifications.where("userId", "==", ctx.userId).orderBy("createdAt", "desc").limit(100).get();
  const items = snap.docs.map((d) => ({ ...d.data(), id: d.id }));
  return (
    <>
      <PageHeader title="Notifications" description="Alerts for your role in this business." actions={items.some((n) => !n.readAt) ? <MarkAllRead /> : undefined} />
      <Card className="mx-auto max-w-3xl">
        {items.length === 0 ? (
          <EmptyState icon={Bell} title="No notifications" description="Low-stock, expiry and approval alerts will appear here." />
        ) : (
          <ul className="divide-y divide-border">
            {items.map((n) => {
              const Icon = ICON[n.type as keyof typeof ICON] ?? Bell;
              const inner = (
                <div className={cn("flex gap-3 px-5 py-4", !n.readAt && "bg-primary-soft/40")}>
                  <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-lg", n.severity === "critical" ? "bg-critical-soft text-critical" : n.severity === "warning" ? "bg-warning-soft text-warning" : "bg-primary-soft text-primary-soft-foreground")}>
                    <Icon className="size-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className={cn("text-sm", !n.readAt && "font-semibold")}>{n.title}</p>
                    {n.body && <p className="mt-0.5 text-sm text-muted">{n.body}</p>}
                    <p className="mt-1 text-xs text-muted">{relativeTime(n.createdAt)}</p>
                  </div>
                  {!n.readAt && <span className="mt-2 size-2 shrink-0 rounded-full bg-primary" aria-label="Unread" />}
                </div>
              );
              return <li key={n.id}>{n.link ? <Link href={n.link} className="block hover:bg-surface-muted">{inner}</Link> : inner}</li>;
            })}
          </ul>
        )}
      </Card>
    </>
  );
}
