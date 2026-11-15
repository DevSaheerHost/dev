"use client";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { flushQueue } from "@/lib/offline/queue";
import { sendOperation } from "@/lib/offline/senders";
import { useToast } from "@/components/ui/toast";
import { useOnline } from "./use-online";

/** Flushes queued offline work when connectivity returns (and on load). */
export function OfflineSync({ businessId }: { businessId: string }) {
  const online = useOnline();
  const toast = useToast();
  const router = useRouter();

  useEffect(() => {
    if (!online) return;
    let cancelled = false;
    flushQueue(sendOperation, businessId)
      .then((s) => {
        if (cancelled) return;
        if (s.sent > 0) {
          toast({ tone: "success", title: `Synced ${s.sent} saved ${s.sent === 1 ? "change" : "changes"}`, description: "Check AI Review for anything that needs confirming." });
          router.refresh();
        }
        if (s.failed > 0) toast({ tone: "error", title: `${s.failed} saved ${s.failed === 1 ? "change was" : "changes were"} rejected`, description: "Open More → Pending to see why." });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [online, businessId, toast, router]);

  // Background Sync: the service worker pings open pages to flush.
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const onMessage = (e: MessageEvent) => {
      if (e.data?.type === "sp-sync") void flushQueue(sendOperation, businessId);
    };
    navigator.serviceWorker.addEventListener("message", onMessage);
    return () => navigator.serviceWorker.removeEventListener("message", onMessage);
  }, [businessId]);

  return null;
}
