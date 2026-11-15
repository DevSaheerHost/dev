"use client";
import { useEffect, useState } from "react";
import { CloudOff, RefreshCw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { flushQueue, listOperations, onQueueChange, removeOperation, type OfflineOperation } from "@/lib/offline/queue";
import { sendOperation } from "@/lib/offline/senders";
import { relativeTime } from "@/lib/utils";
import { useOnline } from "./use-online";

export function PendingOperations({ businessId }: { businessId: string }) {
  const [ops, setOps] = useState<OfflineOperation[]>([]);
  const [busy, setBusy] = useState(false);
  const online = useOnline();
  useEffect(() => {
    const refresh = () => listOperations(businessId).then(setOps).catch(() => {});
    refresh();
    return onQueueChange(refresh);
  }, [businessId]);

  return (
    <section id="pending" className="rounded-xl border border-border bg-surface p-4 shadow-card">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold">Saved on this device</h2>
          <p className="text-xs text-muted">{ops.length === 0 ? "Nothing waiting to sync." : online ? "These will sync automatically." : "You're offline. These will sync when you reconnect."}</p>
        </div>
        {ops.length > 0 && online && (
          <Button size="sm" variant="outline" loading={busy} onClick={async () => { setBusy(true); try { await flushQueue(sendOperation, businessId); } finally { setBusy(false); } }}>
            <RefreshCw /> Sync now
          </Button>
        )}
      </div>
      {ops.length > 0 && (
        <ul className="space-y-2">
          {ops.map((o) => (
            <li key={o.id} className="flex items-center gap-3 rounded-lg bg-surface-muted/60 px-3 py-2 text-sm">
              <CloudOff className={o.status === "failed" ? "size-4 text-critical" : "size-4 text-muted"} aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="truncate">{o.label}</p>
                <p className="text-xs text-muted">{o.status === "failed" ? `Rejected: ${o.lastError}` : `Saved ${relativeTime(new Date(o.createdAt))}${o.attempts ? ` · ${o.attempts} attempts` : ""}`}</p>
              </div>
              <button onClick={() => void removeOperation(o.id)} className="rounded p-1 text-muted hover:text-critical" aria-label="Discard"><Trash2 className="size-4" /></button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
