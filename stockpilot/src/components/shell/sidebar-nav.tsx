"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { MemberRole } from "@/lib/domain/types";
import { cn } from "@/lib/utils";
import { GROUP_LABELS, navFor, type NavItem } from "./nav-items";

export function SidebarNav({ role, reviewCount }: { role: MemberRole; reviewCount: number }) {
  const pathname = usePathname();
  const items = navFor(role);
  const groups = Object.keys(GROUP_LABELS) as NavItem["group"][];
  return (
    <nav aria-label="Main" className="flex flex-col gap-5">
      {groups.map((g) => {
        const groupItems = items.filter((i) => i.group === g);
        if (groupItems.length === 0) return null;
        return (
          <div key={g}>
            <p className="px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted/80">{GROUP_LABELS[g]}</p>
            <ul className="flex flex-col gap-0.5">
              {groupItems.map((item) => {
                const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                        active ? "bg-primary-soft text-primary-soft-foreground" : "text-muted hover:bg-surface-muted hover:text-foreground",
                      )}
                    >
                      <item.icon className="size-[18px]" />
                      <span className="flex-1">{item.label}</span>
                      {item.href === "/review" && reviewCount > 0 && (
                        <span className="tabular rounded-full bg-primary px-1.5 text-[11px] font-semibold text-primary-foreground">{reviewCount > 99 ? "99+" : reviewCount}</span>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}
