"use client";
import { AlertTriangle, CheckCircle2, HelpCircle, Lock, MessageSquareText, Quote, XCircle } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Confidence } from "@/components/ui/feedback";
import { Input, Select, Textarea } from "@/components/ui/form";
import type { MemberRole, MovementType } from "@/lib/domain/types";
import type { ReviewItemView } from "@/lib/review-types";
import { cn, formatNumber } from "@/lib/utils";
import { CandidateChips, ProductSearch, type PickedProduct } from "./product-picker";

export interface ProposalDraft {
  include: boolean;
  productId: string | null;
  productName: string | null;
  unit: string | null;
  currentQuantity: number | null;
  movementType: MovementType | null;
  quantity: string;
}

export type ItemOutcome = { state: "applied"; message: string } | { state: "failed"; message: string } | { state: "escalated"; message: string } | { state: "rejected" };

export const ACTION_OPTIONS: { value: MovementType; label: string; managerOnly?: boolean }[] = [
  { value: "set_count", label: "Counted — set stock to" },
  { value: "receive", label: "Received — add" },
  { value: "sale", label: "Sold — remove" },
  { value: "damage", label: "Damaged — remove" },
  { value: "expire", label: "Expired — remove" },
  { value: "missing", label: "Missing — remove" },
  { value: "return", label: "Customer return — add" },
  { value: "correction", label: "Correction (±)", managerOnly: true },
];

const RANK: Record<MemberRole, number> = { employee: 1, manager: 2, owner: 3 };

export function initialDraft(item: ReviewItemView): ProposalDraft {
  const name = item.matchedProductName ?? (item.matchedProductId ? item.candidates.find((c) => c.productId === item.matchedProductId)?.name ?? null : null);
  return {
    include: item.status === "pending" && !!item.matchedProductId && !!item.movementType && item.baseQuantity !== null,
    productId: item.matchedProductId,
    productName: name,
    unit: item.baseUnit,
    currentQuantity: item.currentQuantity,
    movementType: item.movementType === "transfer" ? null : item.movementType,
    quantity: item.baseQuantity === null ? "" : String(item.baseQuantity),
  };
}

export function draftIsComplete(d: ProposalDraft): boolean {
  const q = Number(d.quantity);
  if (!d.productId || !d.movementType || d.quantity.trim() === "" || !Number.isFinite(q)) return false;
  if (d.movementType === "correction") return q !== 0;
  if (d.movementType === "set_count") return q >= 0;
  return q > 0;
}

export function canApprove(item: ReviewItemView, role: MemberRole): boolean {
  return RANK[role] >= RANK[item.requiresRole];
}

function projected(d: ProposalDraft): number | null {
  const q = Number(d.quantity);
  if (d.currentQuantity === null || !Number.isFinite(q) || !d.movementType) return null;
  switch (d.movementType) {
    case "set_count": return q;
    case "receive": case "return": case "correction": return d.currentQuantity + q;
    case "sale": case "damage": case "expire": case "missing": return d.currentQuantity - q;
    default: return d.currentQuantity;
  }
}

export function ProposalCard({
  item,
  draft,
  onChange,
  role,
  outcome,
  onClarify,
  onReject,
  imageUrl,
}: {
  item: ReviewItemView;
  draft: ProposalDraft;
  onChange: (d: ProposalDraft) => void;
  role: MemberRole;
  outcome?: ItemOutcome;
  onClarify?: (answer: string) => Promise<void>;
  onReject?: () => Promise<void>;
  imageUrl?: string | null;
}) {
  const [picking, setPicking] = useState(false);
  const [answering, setAnswering] = useState(false);
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);
  const allowed = canApprove(item, role);
  const complete = draftIsComplete(draft);
  const after = projected(draft);
  const done = outcome?.state === "applied" || outcome?.state === "rejected" || outcome?.state === "escalated";
  const isAmbiguousCount = item.movementType === null && item.clarificationQuestion?.includes("currently available");

  const pick = (p: PickedProduct) => {
    onChange({ ...draft, productId: p.id, productName: p.name, unit: p.unit, currentQuantity: p.currentQuantity, include: true });
    setPicking(false);
  };

  return (
    <article
      className={cn(
        "rounded-xl border bg-surface p-4 shadow-card transition-opacity",
        outcome?.state === "applied" ? "border-success/40" : outcome?.state === "failed" ? "border-critical/40" : "border-border",
        done && "opacity-75",
      )}
      aria-label={`Suggestion for ${item.spokenProduct}`}
    >
      <div className="flex items-start gap-3">
        {!done && (
          <input
            type="checkbox"
            className="mt-1 size-5 shrink-0 rounded accent-[var(--primary)]"
            checked={draft.include && complete && allowed}
            disabled={!complete || !allowed}
            onChange={(e) => onChange({ ...draft, include: e.target.checked })}
            aria-label="Include this change"
          />
        )}
        <div className="min-w-0 flex-1 space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-xs font-medium uppercase tracking-wide text-muted">Heard</p>
              <p className="font-semibold">{item.spokenProduct}</p>
              {item.evidence && (
                <p className="mt-1 flex gap-1.5 text-sm text-muted"><Quote className="mt-0.5 size-3.5 shrink-0" aria-hidden /><span className="italic">{item.evidence}</span></p>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {item.riskLevel === "high" && <Badge tone="critical"><AlertTriangle /> High risk</Badge>}
              {item.riskLevel === "medium" && <Badge tone="warning">Check carefully</Badge>}
              {item.quantityKind !== "confirmed" && <Badge tone="warning">{item.quantityKind === "visible" ? "Visible only" : "Estimate"}</Badge>}
              {!allowed && <Badge tone="primary"><Lock /> Needs {item.requiresRole}</Badge>}
            </div>
          </div>

          {imageUrl && (
            // eslint-disable-next-line @next/next/no-img-element -- signed, short-lived storage URL
            <img src={imageUrl} alt="Audit photo" className="max-h-40 rounded-lg border border-border object-contain" />
          )}

          <div className="grid gap-3 sm:grid-cols-[1.4fr_1fr_0.8fr]">
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-muted">Product</p>
              {draft.productId ? (
                <div className="flex items-center justify-between gap-2 rounded-lg border border-border bg-surface-muted/60 px-3 py-2">
                  <span className="truncate text-sm font-medium">{draft.productName ?? "Selected product"}</span>
                  {!done && <button type="button" className="shrink-0 text-xs font-medium text-primary hover:underline" onClick={() => setPicking(true)}>Change</button>}
                </div>
              ) : (
                <Button type="button" variant="outline" className="w-full justify-start" onClick={() => setPicking(true)} disabled={done}>
                  <HelpCircle className="text-warning" /> Choose product
                </Button>
              )}
              {!done && item.candidates.length > 1 && <CandidateChips candidates={item.candidates} selectedId={draft.productId} onSelect={pick} />}
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted" htmlFor={`action-${item.id}`}>What happened</label>
              <Select
                id={`action-${item.id}`}
                value={draft.movementType ?? ""}
                disabled={done}
                onChange={(e) => onChange({ ...draft, movementType: (e.target.value || null) as MovementType | null, include: true })}
              >
                <option value="">Choose…</option>
                {ACTION_OPTIONS.filter((o) => !o.managerOnly || role !== "employee").map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </Select>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted" htmlFor={`qty-${item.id}`}>Quantity{draft.unit ? ` (${draft.unit})` : ""}</label>
              <Input
                id={`qty-${item.id}`}
                inputMode="decimal"
                value={draft.quantity}
                disabled={done}
                onChange={(e) => onChange({ ...draft, quantity: e.target.value.replace(/[^0-9.\-]/g, ""), include: true })}
                className="tabular"
              />
            </div>
          </div>

          {(item.inputQuantity !== null || draft.currentQuantity !== null) && (
            <p className="tabular text-xs text-muted">
              {item.inputQuantity !== null && <>Heard {formatNumber(item.inputQuantity)} {item.inputUnit ?? ""}</>}
              {draft.currentQuantity !== null && after !== null && <> · Stock {formatNumber(draft.currentQuantity)} → <span className={cn("font-semibold", after < 0 ? "text-critical" : "text-foreground")}>{formatNumber(after)}</span></>}
            </p>
          )}

          {item.clarificationQuestion && !done && (
            <div className="rounded-lg border border-warning/30 bg-warning-soft px-3 py-2.5 text-sm">
              <p className="flex gap-2 font-medium text-warning"><HelpCircle className="mt-0.5 size-4 shrink-0" />{item.clarificationQuestion}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {isAmbiguousCount && (
                  <>
                    <Button size="sm" variant="outline" onClick={() => onChange({ ...draft, movementType: "set_count", quantity: draft.quantity || String(item.inputQuantity ?? ""), include: true })}>That&apos;s what&apos;s on hand</Button>
                    <Button size="sm" variant="outline" onClick={() => onChange({ ...draft, movementType: "receive", quantity: draft.quantity || String(item.inputQuantity ?? ""), include: true })}>They just arrived</Button>
                  </>
                )}
                {onClarify && <Button size="sm" variant="ghost" onClick={() => setAnswering(true)}><MessageSquareText /> Say it differently</Button>}
              </div>
            </div>
          )}

          {item.warnings.length > 0 && (
            <ul className="space-y-1">
              {item.warnings.map((w) => (
                <li key={w} className="flex gap-2 text-xs text-muted"><AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warning" aria-hidden />{w}</li>
              ))}
            </ul>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
            <div className="flex flex-wrap items-center gap-4">
              <span className="flex items-center gap-1.5 text-xs text-muted">AI <Confidence value={item.aiConfidence} label="AI confidence" /></span>
              {item.matchConfidence !== null && <span className="flex items-center gap-1.5 text-xs text-muted">Match <Confidence value={item.matchConfidence} label="Product match confidence" /></span>}
            </div>
            {outcome ? (
              <span className={cn("flex items-center gap-1.5 text-sm font-medium", outcome.state === "applied" && "text-success", outcome.state === "failed" && "text-critical", outcome.state === "escalated" && "text-primary", outcome.state === "rejected" && "text-muted")}>
                {outcome.state === "applied" ? <CheckCircle2 className="size-4" /> : outcome.state === "rejected" ? <XCircle className="size-4" /> : <AlertTriangle className="size-4" />}
                {outcome.state === "rejected" ? "Dismissed" : outcome.message}
              </span>
            ) : (
              onReject && (
                <Button size="sm" variant="ghost" loading={busy} onClick={async () => { setBusy(true); try { await onReject(); } finally { setBusy(false); } }}>
                  <XCircle /> Dismiss
                </Button>
              )
            )}
          </div>
        </div>
      </div>

      <Dialog open={picking} onOpenChange={setPicking}>
        <DialogContent title="Choose the product" description={`Which product did “${item.spokenProduct}” mean?`}>
          {item.candidates.length > 0 && (
            <div className="mb-4">
              <p className="mb-2 text-xs font-medium text-muted">Best matches</p>
              <CandidateChips candidates={item.candidates} selectedId={draft.productId} onSelect={pick} />
            </div>
          )}
          <ProductSearch onPick={pick} autoFocus />
        </DialogContent>
      </Dialog>

      {onClarify && (
        <Dialog open={answering} onOpenChange={setAnswering}>
          <DialogContent title="Say it differently" description="Describe this change again, as precisely as you can. The original suggestion will be replaced.">
            <Textarea value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder="e.g. Five AA battery packs are on the shelf right now" autoFocus maxLength={1000} />
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="outline" onClick={() => setAnswering(false)}>Cancel</Button>
              <Button
                loading={busy}
                disabled={answer.trim().length < 2}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await onClarify(answer.trim());
                    setAnswering(false);
                    setAnswer("");
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Interpret again
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </article>
  );
}
