"use client";
import { Search } from "lucide-react";
import { useEffect, useState } from "react";
import { Input } from "@/components/ui/form";
import { cn, formatNumber } from "@/lib/utils";

export interface PickedProduct {
  id: string;
  name: string;
  unit: string | null;
  currentQuantity: number | null;
}

/** Search the catalog (RLS-scoped) and pick a product. */
export function ProductSearch({ onPick, autoFocus }: { onPick: (p: PickedProduct) => void; autoFocus?: boolean }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<PickedProduct[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/products/search?q=${encodeURIComponent(q)}`, { signal: controller.signal });
        if (res.ok) {
          const body = (await res.json()) as { products: { id: string; name: string; unit: string; current_quantity: number }[] };
          setResults(body.products.map((p) => ({ id: p.id, name: p.name, unit: p.unit, currentQuantity: Number(p.current_quantity) })));
        }
      } catch {
        // aborted or offline
      } finally {
        setLoading(false);
      }
    }, 200);
    return () => {
      clearTimeout(t);
      controller.abort();
    };
  }, [q]);

  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, SKU or barcode" className="pl-9" autoFocus={autoFocus} aria-label="Search products" />
      </div>
      <ul className="max-h-56 overflow-y-auto rounded-lg border border-border" aria-busy={loading}>
        {results.length === 0 && <li className="px-3 py-3 text-sm text-muted">{loading ? "Searching…" : "No products found."}</li>}
        {results.map((p) => (
          <li key={p.id}>
            <button type="button" onClick={() => onPick(p)} className="flex w-full items-center justify-between gap-3 border-b border-border px-3 py-2.5 text-left text-sm last:border-0 hover:bg-surface-muted">
              <span className="truncate font-medium">{p.name}</span>
              <span className="tabular shrink-0 text-xs text-muted">{formatNumber(p.currentQuantity)} {p.unit}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function CandidateChips({
  candidates,
  selectedId,
  onSelect,
}: {
  candidates: { productId: string; name: string; score: number; unit?: string | null; currentQuantity?: number | null }[];
  selectedId: string | null;
  onSelect: (p: PickedProduct) => void;
}) {
  if (candidates.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Possible matches">
      {candidates.slice(0, 4).map((c) => (
        <button
          key={c.productId}
          type="button"
          role="radio"
          aria-checked={selectedId === c.productId}
          onClick={() => onSelect({ id: c.productId, name: c.name, unit: c.unit ?? null, currentQuantity: c.currentQuantity ?? null })}
          className={cn(
            "flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
            selectedId === c.productId ? "border-primary bg-primary-soft text-primary-soft-foreground" : "border-border bg-surface hover:border-border-strong",
          )}
        >
          <span className="truncate">{c.name}</span>
          <span className="tabular text-muted">{Math.round(c.score * 100)}%</span>
        </button>
      ))}
    </div>
  );
}
