/**
 * The shop list.
 *
 * One row per shop, in the shape a shop ledger is read in: who, when it was
 * last touched, and what the balance is right now — with the direction written
 * out in words beside the tint, because a colour alone says nothing to a
 * colour-blind eye.
 *
 * The figures come from `computeShopFigures`, the same function the dashboard
 * and the shop page use, so the three can never disagree. This screen used to
 * show the stored *opening* balance, which stopped being the interesting number
 * the moment the ledger engine landed.
 *
 * Archived shops have no live listeners, so they are listed plainly with their
 * recorded opening figure and a way back.
 */

import { useMemo, useState } from 'react';
import { ArchiveRestore, Plus, Search, Store } from 'lucide-react';

import {
  Amount,
  Banner,
  Button,
  Card,
  EmptyState,
  SectionHeading,
  Spinner,
} from '@/components/ui';
import { today as todayFn } from '@/lib/clock';
import { setShopStatus } from '@/data/shops';
import { useAllLedgers } from '@/features/ledger/LedgerProvider';
import { computeShopFigures } from '@/features/ledger/figures';
import type { Shop } from '@/types/models';

import { useAuth } from '../auth/AuthProvider';
import { AskSheet } from './AskSheet';
import { ArchivedShopRow, ShopBalanceRow } from './ShopBalanceRow';
import { ShopForm } from './ShopForm';
import { useShops } from './ShopsProvider';

/** Searching a list of shops is a plain name match; no fuzzy guessing. */
function matchesSearch(shop: Shop, needle: string): boolean {
  if (needle === '') return true;
  return `${shop.name} ${shop.description}`.toLowerCase().includes(needle);
}

export function ShopsPage({ onOpenShop }: { onOpenShop: (shopId: string) => void }) {
  const { uid, displayName } = useAuth();
  const { activeShops, archivedShops, loading, error, selectShop } = useShops();
  const { ledgers } = useAllLedgers();
  // `null` means closed; `{ shop: null }` means adding. Closing unmounts the
  // form, so the next open always starts from a fresh draft with no effect
  // syncing props into state.
  const [editing, setEditing] = useState<{ shop: Shop | null } | null>(null);
  const [asking, setAsking] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const today = todayFn();

  const figures = useMemo(
    () =>
      activeShops.map((shop) => {
        const ledger = ledgers.get(shop.id);
        return computeShopFigures({
          shop,
          transactions: ledger?.transactions ?? [],
          configs: ledger?.configs ?? [],
          days: ledger?.days ?? [],
          today,
        });
      }),
    [activeShops, ledgers, today],
  );

  const needle = search.trim().toLowerCase();
  const visible = figures.filter((entry) => matchesSearch(entry.shop, needle));
  const visibleArchived = archivedShops.filter((shop) => matchesSearch(shop, needle));
  const askingFigures = asking ? figures.find((entry) => entry.shop.id === asking) : undefined;

  function openForm(shop: Shop | null) {
    setEditing({ shop });
  }

  function restore(shop: Shop) {
    if (!uid) return;
    setBusyId(shop.id);
    setActionError(null);
    try {
      // Not awaited — the snapshot listener reflects it immediately, online or
      // off. See the note in `data/writes.ts`.
      setShopStatus(uid, shop.id, 'active');
    } catch {
      setActionError('Could not change that shop. Please try again.');
    } finally {
      setBusyId(null);
    }
  }

  if (loading) return <Spinner label="Loading your shops" />;

  const nothingAtAll = activeShops.length === 0 && archivedShops.length === 0;

  return (
    <div className="flex flex-col gap-6 pb-20 sm:pb-0">
      <header>
        <h1 className="text-xl font-bold text-ink">Shops</h1>
        <p className="mt-0.5 text-sm text-ink-2">
          Every place you work. Archive one when you leave; its history stays.
        </p>
      </header>

      {error ? <Banner tone="debit">{error}</Banner> : null}
      {actionError ? <Banner tone="danger">{actionError}</Banner> : null}

      {nothingAtAll ? (
        <Card>
          <EmptyState
            icon={<Store size={28} />}
            title="No shops yet"
            action={
              <Button tone="primary" onClick={() => openForm(null)}>
                <Plus size={16} />
                Add your first shop
              </Button>
            }
          >
            Add the shops you work at. Each one keeps its own salary, expenses and balance, and the
            dashboard adds them up.
          </EmptyState>
        </Card>
      ) : null}

      {activeShops.length + archivedShops.length > 4 ? (
        <div className="relative">
          <Search
            size={15}
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-3"
          />
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search shops"
            aria-label="Search shops"
            className="min-h-11 w-full rounded-xl border border-line-strong bg-surface pr-3 pl-9 text-base text-ink placeholder:text-ink-3 focus:border-accent"
          />
        </div>
      ) : null}

      {activeShops.length > 0 ? (
        <section>
          <SectionHeading title={`Active (${activeShops.length})`} />
          <Card>
            {visible.length === 0 ? (
              <EmptyState title="No shop matches that">Try a different name.</EmptyState>
            ) : (
              <ul>
                {visible.map((entry) => (
                  <ShopBalanceRow
                    key={entry.shop.id}
                    figures={entry}
                    today={today}
                    onOpen={() => {
                      selectShop(entry.shop.id);
                      onOpenShop(entry.shop.id);
                    }}
                    onAsk={() => setAsking(entry.shop.id)}
                  />
                ))}
              </ul>
            )}
          </Card>
        </section>
      ) : null}

      {visibleArchived.length > 0 ? (
        <section>
          <SectionHeading
            title={`Archived (${archivedShops.length})`}
            description="Hidden from the dashboard. Nothing has been deleted."
          />
          <Card>
            <ul>
              {visibleArchived.map((shop) => (
                <ArchivedShopRow key={shop.id} name={shop.name}>
                  <span className="flex shrink-0 items-center gap-2">
                    <span className="hidden text-right sm:block">
                      <span className="block text-[0.65rem] tracking-wide text-ink-3 uppercase">
                        opened
                      </span>
                      <Amount value={shop.openingBalance} tone="balance" size="sm" />
                    </span>
                    <button
                      type="button"
                      onClick={() => restore(shop)}
                      disabled={busyId === shop.id}
                      className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-line-strong px-3 text-xs font-semibold text-ink-2 hover:bg-surface-2 disabled:opacity-50"
                    >
                      <ArchiveRestore size={14} />
                      Restore
                    </button>
                  </span>
                </ArchivedShopRow>
              ))}
            </ul>
          </Card>
        </section>
      ) : null}

      {/* Adding a shop, always within a thumb's reach. */}
      {nothingAtAll ? null : (
        <button
          type="button"
          onClick={() => openForm(null)}
          className="fixed right-4 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-20 inline-flex min-h-14 items-center gap-2 rounded-2xl bg-accent px-5 text-sm font-bold text-accent-contrast shadow-float hover:bg-accent-ink sm:static sm:bottom-auto sm:self-start sm:shadow-none"
        >
          <Plus size={18} />
          Add a shop
        </button>
      )}

      {/*
        Keying on the shop id remounts the form when the user moves straight
        from editing one shop to another, which is what resets the draft.
      */}
      {editing ? (
        <ShopForm
          key={editing.shop?.id ?? 'new'}
          open
          shop={editing.shop}
          onClose={() => setEditing(null)}
          onSaved={(shopId) => {
            selectShop(shopId);
            onOpenShop(shopId);
          }}
        />
      ) : null}

      {askingFigures ? (
        <AskSheet
          shop={askingFigures.shop}
          balance={askingFigures.balance}
          unconfirmed={askingFigures.unposted}
          personName={displayName}
          today={today}
          onClose={() => setAsking(null)}
          onEditShop={() => {
            setAsking(null);
            openForm(askingFigures.shop);
          }}
        />
      ) : null}
    </div>
  );
}
