"use client";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { AlertTriangle, CheckCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { enqueue } from "@/lib/offline/queue";
import type { MemberRole } from "@/lib/domain/types";
import { MOVEMENT_LABELS } from "@/lib/domain/types";
import type { ExtractionOutcome, ReviewItemView } from "@/lib/review-types";
import { formatNumber, newClientId } from "@/lib/utils";
import { canApprove, draftIsComplete, initialDraft, ProposalCard, type ItemOutcome, type ProposalDraft } from "./proposal-card";

interface ApplyResult {
  id: string;
  ok: boolean;
  message?: string;
  escalated?: boolean;
  quantityAfter?: number;
  duplicate?: boolean;
}

const REMOVALS = new Set(["damage", "expire", "missing", "sale"]);

export function ProposalList({
  initialItems,
  role,
  businessId,
  imageUrls,
  allowClarify = true,
  observedAt,
  observedAtById,
  onFinished,
}: {
  initialItems: ReviewItemView[];
  role: MemberRole;
  businessId: string;
  imageUrls?: Record<string, string | null>;
  allowClarify?: boolean;
  /** When the audit was recorded: protects against applying stale counts. */
  observedAt?: string;
  /** Per-item observation times (e.g. when a queued suggestion was recorded). */
  observedAtById?: Record<string, string>;
  onFinished?: () => void;
}) {
  const toast = useToast();
  const router = useRouter();
  const [items, setItems] = useState(initialItems);
  const [drafts, setDrafts] = useState<Record<string, ProposalDraft>>(() => Object.fromEntries(initialItems.map((i) => [i.id, initialDraft(i)])));
  const [outcomes, setOutcomes] = useState<Record<string, ItemOutcome>>({});
  const [confirming, setConfirming] = useState(false);
  const [applying, setApplying] = useState(false);

  const selected = useMemo(
    () => items.filter((i) => !outcomes[i.id] || outcomes[i.id].state === "failed").filter((i) => drafts[i.id]?.include && draftIsComplete(drafts[i.id]) && canApprove(i, role)),
    [items, drafts, outcomes, role],
  );
  const risky = selected.filter((i) => i.riskLevel !== "low" || REMOVALS.has(drafts[i.id].movementType ?? ""));
  const open = items.filter((i) => !outcomes[i.id] || outcomes[i.id].state === "failed");
  const waitingForManager = open.filter((i) => !canApprove(i, role)).length;

  const payload = () => ({
    items: selected.map((i) => {
      const d = drafts[i.id];
      return {
        id: i.id,
        productId: d.productId!,
        movementType: d.movementType!,
        baseQuantity: Number(d.quantity),
        inputQuantity: i.inputQuantity,
        inputUnit: i.inputUnit,
        batchId: d.productId === i.matchedProductId ? i.batchId : null,
        batchNumber: i.batchNumber,
        expiryDate: i.expiryDate,
        observedAt: d.movementType === "set_count" ? observedAtById?.[i.id] ?? observedAt ?? null : null,
      };
    }),
  });

  async function apply() {
    setApplying(true);
    try {
      if (!navigator.onLine) {
        await enqueue({ id: newClientId("apply"), kind: "review_apply", businessId, label: `Apply ${selected.length} AI ${selected.length === 1 ? "change" : "changes"}`, payload: payload() });
        const pending: Record<string, ItemOutcome> = {};
        for (const i of selected) pending[i.id] = { state: "escalated", message: "Saved offline · not applied yet" };
        setOutcomes((o) => ({ ...o, ...pending }));
        toast({ tone: "info", title: "You're offline", description: "Changes are saved on this device and will be applied when you're back online. Nothing has changed yet." });
        return;
      }
      const res = await fetch("/api/review/apply", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload()) });
      const body = (await res.json()) as { results?: ApplyResult[]; error?: { message: string } };
      if (!res.ok || !body.results) {
        toast({ tone: "error", title: "Couldn't apply changes", description: body.error?.message });
        return;
      }
      const next: Record<string, ItemOutcome> = {};
      let applied = 0;
      for (const r of body.results) {
        if (r.ok) {
          applied++;
          next[r.id] = { state: "applied", message: `Applied · now ${formatNumber(r.quantityAfter)}` };
        } else if (r.escalated) next[r.id] = { state: "escalated", message: r.message ?? "Sent for approval" };
        else next[r.id] = { state: "failed", message: r.message ?? "Failed" };
      }
      setOutcomes((o) => ({ ...o, ...next }));
      const failed = body.results.length - applied;
      toast({
        tone: failed ? "error" : "success",
        title: applied ? `${applied} ${applied === 1 ? "change" : "changes"} applied` : "No changes applied",
        description: failed ? `${failed} could not be applied — see details on each card.` : "Stock levels and the audit log are updated.",
      });
      router.refresh();
      if (!failed) onFinished?.();
    } catch {
      toast({ tone: "error", title: "Network problem", description: "Nothing was applied. Please try again." });
    } finally {
      setApplying(false);
      setConfirming(false);
    }
  }

  async function reject(id: string) {
    const res = await fetch("/api/review/reject", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ids: [id] }) });
    if (res.ok) setOutcomes((o) => ({ ...o, [id]: { state: "rejected" } }));
    else toast({ tone: "error", title: "Couldn't dismiss", description: ((await res.json()) as { error?: { message: string } }).error?.message });
  }

  async function clarify(id: string, answer: string) {
    const res = await fetch("/api/review/clarify", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ itemId: id, answer }) });
    const body = (await res.json()) as ExtractionOutcome & { supersededId: string | null; error?: { message: string } };
    if (!res.ok) {
      toast({ tone: "error", title: "Couldn't interpret that", description: body.error?.message });
      return;
    }
    if (body.items.length === 0) {
      toast({ tone: "info", title: "Still not clear", description: body.questions[0] ?? "Try naming the product, the quantity and what happened." });
      return;
    }
    setItems((all) => all.flatMap((i) => (i.id === id ? body.items : [i])));
    setDrafts((d) => ({ ...d, ...Object.fromEntries(body.items.map((i) => [i.id, initialDraft(i)])) }));
  }

  return (
    <div className="space-y-3">
      {items.map((item) => (
        <ProposalCard
          key={item.id}
          item={item}
          draft={drafts[item.id]}
          onChange={(d) => setDrafts((all) => ({ ...all, [item.id]: d }))}
          role={role}
          outcome={outcomes[item.id]}
          onReject={() => reject(item.id)}
          onClarify={allowClarify ? (a) => clarify(item.id, a) : undefined}
          imageUrl={imageUrls?.[item.id]}
        />
      ))}

      {open.length > 0 && (
        <div className="sticky bottom-20 z-20 flex flex-col gap-2 rounded-xl border border-border bg-surface/95 p-3 shadow-pop backdrop-blur sm:flex-row sm:items-center sm:justify-between lg:bottom-4">
          <p className="text-sm text-muted">
            <span className="font-semibold text-foreground">{selected.length}</span> of {open.length} ready to apply
            {waitingForManager > 0 && <> · {waitingForManager} waiting for a manager</>}
          </p>
          <Button size="lg" disabled={selected.length === 0} loading={applying} onClick={() => (risky.length ? setConfirming(true) : apply())}>
            <CheckCheck /> Apply {selected.length || ""} {selected.length === 1 ? "change" : "changes"}
          </Button>
        </div>
      )}

      <Dialog open={confirming} onOpenChange={(o) => !applying && setConfirming(o)}>
        <DialogContent title="Confirm these changes" description="Some of these remove stock or are unusually large. Check them once more.">
          <ul className="space-y-2">
            {selected.map((i) => {
              const d = drafts[i.id];
              const flagged = risky.includes(i);
              return (
                <li key={i.id} className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2 text-sm">
                  <span className="flex min-w-0 items-center gap-2">
                    {flagged && <AlertTriangle className="size-4 shrink-0 text-warning" aria-label="Needs attention" />}
                    <span className="truncate">{d.productName}</span>
                  </span>
                  <span className="tabular shrink-0 text-muted">{MOVEMENT_LABELS[d.movementType!]} {formatNumber(Number(d.quantity))} {d.unit ?? ""}</span>
                </li>
              );
            })}
          </ul>
          <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="outline" onClick={() => setConfirming(false)} disabled={applying}>Go back</Button>
            <Button onClick={apply} loading={applying}>Yes, apply</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
