import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { PendingOperations } from "@/components/pwa/pending-operations";
import { navFor } from "@/components/shell/nav-items";
import { PageHeader } from "@/components/ui/page";
import { requireContext } from "@/lib/auth/session";

export const metadata = { title: "More" };

export default async function MorePage() {
  const ctx = await requireContext();
  const items = navFor(ctx.role).filter((i) => !["/dashboard", "/voice", "/photo", "/inventory"].includes(i.href));
  return (
    <>
      <PageHeader title="More" />
      <div className="mx-auto max-w-lg space-y-5">
        <nav aria-label="More pages" className="overflow-hidden rounded-xl border border-border bg-surface shadow-card">
          <ul className="divide-y divide-border">
            {items.map((i) => (
              <li key={i.href}>
                <Link href={i.href} className="flex items-center gap-3 px-4 py-3.5 text-sm font-medium hover:bg-surface-muted">
                  <i.icon className="size-5 text-muted" /> <span className="flex-1">{i.label}</span> <ChevronRight className="size-4 text-muted" />
                </Link>
              </li>
            ))}
            <li>
              <Link href="/notifications" className="flex items-center gap-3 px-4 py-3.5 text-sm font-medium hover:bg-surface-muted">
                <span className="size-5" /> <span className="flex-1">Notifications</span> <ChevronRight className="size-4 text-muted" />
              </Link>
            </li>
          </ul>
        </nav>
        <PendingOperations businessId={ctx.business.id} />
      </div>
    </>
  );
}
