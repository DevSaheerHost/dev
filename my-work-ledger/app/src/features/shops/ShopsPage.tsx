/**
 * The shop list.
 *
 * Each card states the one thing that matters about a shop — what it owes you
 * right now — in words as well as figures, so a negative balance reads as
 * "you owe Blue Mart ₹450" rather than as a minus sign the eye can skip.
 *
 * Until the ledger engine lands in Phase 2 the figure shown is the recorded
 * starting balance, labelled as such. It is a real stored number, not a
 * placeholder, and it is what the engine will open the first period with.
 */

import { useState } from 'react';
import { Archive, ArchiveRestore, CalendarDays, Pencil, Plus, Store } from 'lucide-react';

import { Amount, Badge, Banner, Button, Card, EmptyState, SectionHeading, Spinner } from '@/components/ui';
import { formatDateShort } from '@/lib/dates';
import { setShopStatus } from '@/data/shops';
import type { Shop } from '@/types/models';

import { useAuth } from '../auth/AuthProvider';
import { ShopForm } from './ShopForm';
import { useShops } from './ShopsProvider';

function BalanceLine({ shop }: { shop: Shop }) {
  if (shop.openingBalance === 0) {
    return <p className="text-sm text-ink-3">Started square — nothing outstanding.</p>;
  }
  const owedToYou = shop.openingBalance > 0;
  return (
    <p className="text-sm text-ink-2">
      {owedToYou ? 'Opening balance owed to you' : 'Opening balance you owe'}{' '}
      <Amount value={shop.openingBalance} tone="balance" size="sm" />{' '}
      <span className="text-ink-3">from {formatDateShort(shop.openingBalanceAsOf)}</span>
    </p>
  );
}

function ShopCard({
  shop,
  onEdit,
  onToggleArchive,
  busy,
}: {
  shop: Shop;
  onEdit: () => void;
  onToggleArchive: () => void;
  busy: boolean;
}) {
  const archived = shop.status === 'archived';
  return (
    <Card as="li" className={`p-4 ${archived ? 'opacity-70' : ''}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate text-base font-semibold text-ink">{shop.name}</h3>
            {archived ? <Badge>Archived</Badge> : null}
            {shop.settlementMode === 'cashOnly' ? <Badge tone="accent">Daily wage</Badge> : null}
          </div>
          {shop.description ? (
            <p className="mt-0.5 truncate text-sm text-ink-3">{shop.description}</p>
          ) : null}
        </div>
        <div className="flex shrink-0 gap-1">
          <button
            type="button"
            onClick={onEdit}
            aria-label={`Edit ${shop.name}`}
            className="grid size-10 place-items-center rounded-lg text-ink-3 hover:bg-surface-2 hover:text-ink"
          >
            <Pencil size={16} />
          </button>
          <button
            type="button"
            onClick={onToggleArchive}
            disabled={busy}
            aria-label={archived ? `Restore ${shop.name}` : `Archive ${shop.name}`}
            className="grid size-10 place-items-center rounded-lg text-ink-3 hover:bg-surface-2 hover:text-ink disabled:opacity-50"
          >
            {archived ? <ArchiveRestore size={16} /> : <Archive size={16} />}
          </button>
        </div>
      </div>

      <div className="mt-3 border-t border-line pt-3">
        <BalanceLine shop={shop} />
        <p className="mt-1.5 flex items-center gap-1.5 text-xs text-ink-3">
          <CalendarDays size={13} />
          Joined {formatDateShort(shop.joiningDate)} &middot; salary on day {shop.salaryPayDay}
        </p>
      </div>
    </Card>
  );
}

export function ShopsPage() {
  const { uid } = useAuth();
  const { activeShops, archivedShops, loading, error, selectShop } = useShops();
  // `null` means closed; `{ shop: null }` means adding. Closing unmounts the
  // form, so the next open always starts from a fresh draft with no effect
  // syncing props into state.
  const [editing, setEditing] = useState<{ shop: Shop | null } | null>(null);

  function openForm(shop: Shop | null) {
    setEditing({ shop });
  }
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  async function toggleArchive(shop: Shop) {
    if (!uid) return;
    setBusyId(shop.id);
    setActionError(null);
    try {
      await setShopStatus(uid, shop.id, shop.status === 'archived' ? 'active' : 'archived');
    } catch {
      setActionError('Could not change that shop. Check your connection and try again.');
    } finally {
      setBusyId(null);
    }
  }

  if (loading) return <Spinner label="Loading your shops" />;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-ink">Shops</h1>
          <p className="mt-0.5 text-sm text-ink-2">
            Every place you work. Archive one when you leave; its history stays.
          </p>
        </div>
        <Button tone="primary" onClick={() => openForm(null)}>
          <Plus size={16} />
          Add
        </Button>
      </header>

      {error ? <Banner tone="debit">{error}</Banner> : null}
      {actionError ? <Banner tone="danger">{actionError}</Banner> : null}

      {activeShops.length === 0 && archivedShops.length === 0 ? (
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

      {activeShops.length > 0 ? (
        <section>
          <SectionHeading title={`Active (${activeShops.length})`} />
          <ul className="flex flex-col gap-3">
            {activeShops.map((shop) => (
              <ShopCard
                key={shop.id}
                shop={shop}
                busy={busyId === shop.id}
                onEdit={() => openForm(shop)}
                onToggleArchive={() => void toggleArchive(shop)}
              />
            ))}
          </ul>
        </section>
      ) : null}

      {archivedShops.length > 0 ? (
        <section>
          <SectionHeading
            title={`Archived (${archivedShops.length})`}
            description="Hidden from the dashboard. Nothing has been deleted."
          />
          <ul className="flex flex-col gap-3">
            {archivedShops.map((shop) => (
              <ShopCard
                key={shop.id}
                shop={shop}
                busy={busyId === shop.id}
                onEdit={() => openForm(shop)}
                onToggleArchive={() => void toggleArchive(shop)}
              />
            ))}
          </ul>
        </section>
      ) : null}

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
          onSaved={(shopId) => selectShop(shopId)}
        />
      ) : null}
    </div>
  );
}
