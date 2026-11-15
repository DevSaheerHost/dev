import Link from "next/link";
import { requireContext } from "@/lib/auth/session";
import { biz } from "@/lib/data/refs";
import { countOpenReviews } from "@/lib/data/review";
import { MobileNav } from "@/components/shell/mobile-nav";
import { SidebarNav } from "@/components/shell/sidebar-nav";
import { Topbar } from "@/components/shell/topbar";
import { OfflineSync } from "@/components/pwa/offline-sync";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireContext();
  const [reviewCount, unread] = await Promise.all([
    countOpenReviews(ctx),
    biz(ctx.business.id).notifications.where("userId", "==", ctx.userId).where("readAt", "==", null).count().get().then((c) => c.data().count),
  ]);

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[256px_1fr]">
      <aside className="sticky top-0 hidden h-dvh flex-col gap-6 overflow-y-auto border-r border-border bg-surface px-3 py-5 lg:flex">
        <Link href="/dashboard" className="flex items-center gap-2.5 px-3">
          <span className="flex size-9 items-center justify-center rounded-xl bg-primary text-sm font-bold text-primary-foreground">SP</span>
          <span>
            <span className="block text-[15px] font-semibold leading-tight">StockPilot AI</span>
            <span className="block text-xs text-muted">Inventory copilot</span>
          </span>
        </Link>
        <SidebarNav role={ctx.role} reviewCount={reviewCount} />
      </aside>
      <div className="flex min-w-0 flex-col">
        <Topbar ctx={ctx} unread={unread} />
        <main id="main" className="mx-auto w-full max-w-7xl flex-1 px-4 pb-28 pt-6 lg:px-8 lg:pb-12">{children}</main>
      </div>
      <MobileNav reviewCount={reviewCount} />
      <OfflineSync businessId={ctx.business.id} />
    </div>
  );
}
