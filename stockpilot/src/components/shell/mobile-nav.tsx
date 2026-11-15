"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Camera, Home, Menu, Mic, Package } from "lucide-react";
import { cn } from "@/lib/utils";

const ITEMS = [
  { href: "/dashboard", label: "Home", icon: Home },
  { href: "/voice", label: "Voice", icon: Mic, primary: true },
  { href: "/photo", label: "Camera", icon: Camera, primary: true },
  { href: "/inventory", label: "Inventory", icon: Package },
  { href: "/more", label: "More", icon: Menu },
];

/** Bottom navigation for phones. Voice and Camera are always one tap away. */
export function MobileNav({ reviewCount }: { reviewCount: number }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Primary" className="safe-bottom fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface/95 backdrop-blur lg:hidden">
      <ul className="mx-auto grid max-w-lg grid-cols-5">
        {ITEMS.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <li key={item.href}>
              <Link href={item.href} aria-current={active ? "page" : undefined} className="flex flex-col items-center gap-1 py-2 text-[11px] font-medium">
                <span
                  className={cn(
                    "relative flex items-center justify-center rounded-full transition-colors",
                    item.primary ? "size-11 bg-primary text-primary-foreground shadow-card" : "size-7",
                    !item.primary && (active ? "text-primary" : "text-muted"),
                    item.primary && active && "ring-4 ring-primary/20",
                  )}
                >
                  <item.icon className={item.primary ? "size-5" : "size-[22px]"} />
                  {item.href === "/more" && reviewCount > 0 && <span className="absolute -right-0.5 -top-0.5 size-2.5 rounded-full bg-critical ring-2 ring-surface" aria-label={`${reviewCount} reviews waiting`} />}
                </span>
                <span className={cn(active ? "text-foreground" : "text-muted")}>{item.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
