import { useEffect, useMemo, useState } from 'react';

import { ItemList } from '@/components/ItemList';
import { Button, Card, CardHeader, Select, cx } from '@/components/ui';
import { KIND_LABEL } from '@/lib/format';
import type { useItems } from '@/hooks/useItems';
import type { FilterState, Item, ItemKind } from '@/types';

const TYPES: Array<'all' | ItemKind> = ['all', 'text', 'image', 'video', 'audio', 'file'];

const SINCE: Array<{ id: FilterState['since']; label: string; ms: number | null }> = [
  { id: 'all', label: 'Any time', ms: null },
  { id: '1h', label: 'Past hour', ms: 60 * 60 * 1000 },
  { id: '24h', label: 'Past day', ms: 24 * 60 * 60 * 1000 },
  { id: '7d', label: 'Past week', ms: 7 * 24 * 60 * 60 * 1000 },
];

/**
 * Search runs over a lowercase index built once per item list, so typing stays
 * responsive even with a few hundred items and long previews.
 */
function buildIndex(items: Item[]): Map<string, string> {
  const index = new Map<string, string>();
  for (const item of items) {
    index.set(
      item.id,
      `${item.fileName ?? ''} ${item.preview} ${item.mimeType ?? ''}`.toLowerCase(),
    );
  }
  return index;
}

export function HistoryPage({ items }: { items: ReturnType<typeof useItems> }) {
  const [filters, setFilters] = useState<FilterState>({ query: '', type: 'all', since: 'all' });
  const index = useMemo(() => buildIndex(items.items), [items.items]);

  /*
   * "Past hour" needs a clock, and reading one during render is impure. The
   * reference time is held in state and refreshed on a slow interval, which
   * also keeps the relative timestamps in the list honest.
   */
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const filtered = useMemo(() => {
    const query = filters.query.trim().toLowerCase();
    const window = SINCE.find((entry) => entry.id === filters.since)?.ms ?? null;
    const cutoff = window === null ? 0 : now - window;

    return items.items.filter((item) => {
      if (filters.type !== 'all' && item.type !== filters.type) return false;
      if (item.createdAt < cutoff) return false;
      if (!query) return true;
      return (index.get(item.id) ?? '').includes(query);
    });
  }, [items.items, filters, index, now]);

  return (
    <Card className="overflow-hidden">
      <CardHeader
        title="History"
        description={`${filtered.length} of ${items.items.length} items in this workspace.`}
      />

      <div className="grid gap-3 border-b border-line px-5 py-4 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
        <div className="grid gap-1.5">
          <label htmlFor="search" className="sr-only">
            Search items
          </label>
          <input
            id="search"
            type="search"
            value={filters.query}
            onChange={(event) => setFilters((current) => ({ ...current, query: event.target.value }))}
            placeholder="Search text, filenames and types"
            className="w-full rounded-xl border border-line bg-surface-2 px-3 py-2 text-sm text-ink hover:border-line-strong focus:border-accent focus:outline-none focus:ring-3 focus:ring-accent-soft"
          />
        </div>

        <div className="grid gap-1.5">
          <label htmlFor="type" className="sr-only">
            Filter by type
          </label>
          <Select
            id="type"
            value={filters.type}
            onChange={(event) =>
              setFilters((current) => ({ ...current, type: event.target.value as FilterState['type'] }))
            }
          >
            {TYPES.map((type) => (
              <option key={type} value={type}>
                {type === 'all' ? 'All types' : KIND_LABEL[type]}
              </option>
            ))}
          </Select>
        </div>

        <div className="grid gap-1.5">
          <label htmlFor="since" className="sr-only">
            Filter by date
          </label>
          <Select
            id="since"
            value={filters.since}
            onChange={(event) =>
              setFilters((current) => ({ ...current, since: event.target.value as FilterState['since'] }))
            }
          >
            {SINCE.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.label}
              </option>
            ))}
          </Select>
        </div>
      </div>

      {(filters.query || filters.type !== 'all' || filters.since !== 'all') && (
        <div className={cx('flex items-center justify-between gap-3 border-b border-line px-5 py-2.5')}>
          <span className="text-[12.5px] text-ink-3">Filters are on</span>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setFilters({ query: '', type: 'all', since: 'all' })}
          >
            Clear filters
          </Button>
        </div>
      )}

      <ItemList
        items={filtered}
        pending={items.pending}
        loading={items.loading}
        onDelete={(item) => void items.removeItem(item)}
        onDiscardPending={(id) => void items.discardPending(id)}
      />
    </Card>
  );
}
