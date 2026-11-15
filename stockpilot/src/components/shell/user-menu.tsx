"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { DropdownMenu } from "radix-ui";
import { LogOut, Monitor, Moon, Settings, Sun } from "lucide-react";
import { useEffect, useState } from "react";
import { clearQueue, listOperations } from "@/lib/offline/queue";
import type { MemberRole } from "@/lib/domain/types";

type Theme = "system" | "light" | "dark";

function applyTheme(theme: Theme) {
  try {
    if (theme === "system") {
      delete document.documentElement.dataset.theme;
      localStorage.removeItem("sp-theme");
    } else {
      document.documentElement.dataset.theme = theme;
      localStorage.setItem("sp-theme", theme);
    }
  } catch {
    // Storage unavailable (private mode): theme applies for this page only.
  }
}

export function UserMenu({ name, email, role }: { name: string; email: string | null; role: MemberRole }) {
  const router = useRouter();
  const [theme, setTheme] = useState<Theme>("system");
  useEffect(() => {
    try {
      const t = localStorage.getItem("sp-theme");
      // eslint-disable-next-line react-hooks/set-state-in-effect -- sync with storage after hydration
      if (t === "light" || t === "dark") setTheme(t);
    } catch {}
  }, []);
  async function handleSignOut() {
    try {
      const pending = await listOperations();
      if (pending.length > 0 && !window.confirm(`${pending.length} change(s) saved on this device haven't synced yet and will be discarded. Sign out anyway?`)) return;
      await clearQueue();
      navigator.serviceWorker?.controller?.postMessage({ type: "sp-clear-cache" });
    } catch {
      // IndexedDB unavailable: nothing stored to clear.
    }
    await fetch("/api/auth/session", { method: "DELETE" }).catch(() => {});
    router.replace("/login");
    router.refresh();
  }

  const initials = name.split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join("") || "U";
  const item = "flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-2 text-sm outline-none data-[highlighted]:bg-surface-muted";

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger className="flex size-9 items-center justify-center rounded-full bg-primary-soft text-xs font-semibold text-primary-soft-foreground" aria-label="Account menu">
        {initials}
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="end" sideOffset={8} className="z-50 w-60 rounded-xl border border-border bg-surface p-1.5 shadow-pop">
          <div className="px-2.5 py-2">
            <p className="truncate text-sm font-semibold">{name}</p>
            {email && <p className="truncate text-xs text-muted">{email}</p>}
            <p className="mt-1 text-xs capitalize text-muted">{role}</p>
          </div>
          <DropdownMenu.Separator className="my-1 h-px bg-border" />
          <DropdownMenu.Label className="px-2.5 pb-1 pt-1.5 text-xs text-muted">Theme</DropdownMenu.Label>
          <DropdownMenu.RadioGroup value={theme} onValueChange={(v) => { setTheme(v as Theme); applyTheme(v as Theme); }}>
            {([["system", Monitor, "System"], ["light", Sun, "Light"], ["dark", Moon, "Dark"]] as const).map(([v, Icon, label]) => (
              <DropdownMenu.RadioItem key={v} value={v} className={item}>
                <Icon className="size-4 text-muted" /> {label}
                <DropdownMenu.ItemIndicator className="ml-auto text-primary">●</DropdownMenu.ItemIndicator>
              </DropdownMenu.RadioItem>
            ))}
          </DropdownMenu.RadioGroup>
          <DropdownMenu.Separator className="my-1 h-px bg-border" />
          <DropdownMenu.Item asChild className={item}>
            <Link href="/settings"><Settings className="size-4 text-muted" /> Settings</Link>
          </DropdownMenu.Item>
          <DropdownMenu.Item className={item} onSelect={() => void handleSignOut()}>
            <LogOut className="size-4 text-muted" /> Sign out
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
