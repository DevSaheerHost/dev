"use client";
import Link from "next/link";
import { CloudOff, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { listOperations, onQueueChange } from "@/lib/offline/queue";
import { useOnline } from "./use-online";

/** Shows offline status and how many changes are waiting to sync. Never claims they are synced. */
export function OfflineIndicator({ businessId }: { businessId: string }) {
  const online = useOnline();
  const [pending, setPending] = useState(0);

  useEffect(() => {
    let alive = true;
    const refresh = () =>
      listOperations(businessId)
        .then((ops) => alive && setPending(ops.length))
        .catch(() => {});
    refresh();
    const off = onQueueChange(refresh);
    return () => {
      alive = false;
      off();
    };
  }, [businessId]);

  if (online && pending === 0) return null;
  return (
    <Link
      href="/more#pending"
      className={`flex h-8 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium ${online ? "bg-primary-soft text-primary-soft-foreground" : "bg-warning-soft text-warning"}`}
    >
      {online ? <RefreshCw className="size-3.5" /> : <CloudOff className="size-3.5" />}
      {online ? `${pending} to sync` : pending > 0 ? `Offline · ${pending} saved` : "Offline"}
    </Link>
  );
}
