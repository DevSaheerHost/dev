import Link from "next/link";
import { Bell, Building2 } from "lucide-react";
import type { AppContext } from "@/lib/auth/session";
import { switchBusiness } from "@/app/actions/session";
import { OfflineIndicator } from "@/components/pwa/offline-indicator";
import { UserMenu } from "./user-menu";

export function Topbar({ ctx, unread }: { ctx: AppContext; unread: number }) {
  return (
    <header className="sticky top-0 z-30 border-b border-border bg-background/90 backdrop-blur">
      <div className="flex h-14 items-center gap-3 px-4 lg:px-8">
        <Link href="/dashboard" className="flex items-center gap-2 lg:hidden" aria-label="StockPilot home">
          <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-sm font-bold text-primary-foreground">SP</span>
        </Link>
        {ctx.memberships.length > 1 ? (
          <form action={switchBusiness} className="flex min-w-0 items-center gap-2">
            <Building2 className="hidden size-4 text-muted sm:block" aria-hidden />
            <label htmlFor="business-switch" className="sr-only">Active business</label>
            <select
              id="business-switch"
              name="businessId"
              defaultValue={ctx.business.id}
              className="h-9 max-w-[11rem] truncate rounded-lg border border-border bg-surface px-2 text-sm font-medium sm:max-w-xs"
            >
              {ctx.memberships.map((m) => (
                <option key={m.businessId} value={m.businessId}>{m.businessName}</option>
              ))}
            </select>
            <button type="submit" className="h-9 rounded-lg border border-border bg-surface px-2.5 text-xs font-medium hover:bg-surface-muted">Switch</button>
          </form>
        ) : (
          <p className="min-w-0 truncate text-sm font-semibold">{ctx.business.name}</p>
        )}
        <div className="ml-auto flex items-center gap-1.5">
          <OfflineIndicator businessId={ctx.business.id} />
          <Link href="/notifications" className="relative flex size-9 items-center justify-center rounded-lg text-muted hover:bg-surface-muted hover:text-foreground" aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`}>
            <Bell className="size-[18px]" />
            {unread > 0 && (
              <span className="tabular absolute right-1 top-1 min-w-4 rounded-full bg-critical px-1 text-center text-[10px] font-bold leading-4 text-white">{unread > 9 ? "9+" : unread}</span>
            )}
          </Link>
          <UserMenu name={ctx.fullName ?? ctx.email ?? "Account"} email={ctx.email} role={ctx.role} />
        </div>
      </div>
    </header>
  );
}
