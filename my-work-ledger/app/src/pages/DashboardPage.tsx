/**
 * The dashboard.
 *
 * In Phase 1 there are no transactions yet, so the only real money figure that
 * exists is each shop's recorded opening balance. That is what this screen
 * shows, labelled as exactly that. Nothing here is invented: no sample
 * transactions, no projected salary, no placeholder totals. A finance screen
 * that shows made-up numbers teaches the user to distrust it, and the first
 * time they cannot tell a real figure from a demo one the app has failed.
 *
 * A notice says plainly what arrives in Phase 2, so the screen is honest about
 * being incomplete rather than looking finished and being wrong.
 */

import { useState } from 'react';
import { Info, Plus, Store, Wallet } from 'lucide-react';

import { Amount, Badge, Banner, Button, Card, EmptyState, SectionHeading, Spinner } from '@/components/ui';
import { formatDateShort } from '@/lib/dates';
import { paise, sumPaise, type Paise } from '@/lib/money';
import { ShopForm } from '@/features/shops/ShopForm';
import { useShops } from '@/features/shops/ShopsProvider';
import type { Shop } from '@/types/models';

/** Phrases a balance in words. A bare minus sign is too easy to overlook. */
function balanceSentence(shop: Shop): string {
  if (shop.openingBalance > 0) return `${shop.name} owes you`;
  if (shop.openingBalance < 0) return `You owe ${shop.name}`;
  return 'Square with you';
}

function ShopRow({ shop }: { shop: Shop }) {
  return (
    <li className="flex items-center justify-between gap-3 border-b border-line px-4 py-3.5 last:border-b-0">
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-ink">{shop.name}</p>
        <p className="mt-0.5 truncate text-xs text-ink-3">
          {balanceSentence(shop)} &middot; from {formatDateShort(shop.openingBalanceAsOf)}
        </p>
      </div>
      <div className="shrink-0 text-right">
        <Amount value={shop.openingBalance} tone="balance" size="md" />
        {shop.settlementMode === 'cashOnly' ? (
          <p className="mt-0.5 text-[0.7rem] text-ink-3">daily wage</p>
        ) : null}
      </div>
    </li>
  );
}

export function DashboardPage() {
  const { activeShops, loading, error, selectShop } = useShops();
  // The dashboard owns its own copy of the form rather than sending the user to
  // the Shops tab to press a second button with the same label.
  const [adding, setAdding] = useState(false);

  const form = adding ? (
    <ShopForm
      open
      shop={null}
      onClose={() => setAdding(false)}
      onSaved={(shopId) => selectShop(shopId)}
    />
  ) : null;

  if (loading) return <Spinner label="Loading your ledger" />;

  if (activeShops.length === 0) {
    return (
      <div className="flex flex-col gap-5">
        {error ? <Banner tone="debit">{error}</Banner> : null}
        <Card>
          <EmptyState
            icon={<Store size={28} />}
            title="Add a shop to begin"
            action={
              <Button tone="primary" onClick={() => setAdding(true)}>
                <Plus size={16} />
                Add your first shop
              </Button>
            }
          >
            Once a shop exists, this screen shows what it owes you and why.
          </EmptyState>
        </Card>
        {form}
      </div>
    );
  }

  // Summed once, here, from stored integers. No component does arithmetic.
  const owedToYou = sumPaise(
    activeShops.filter((shop) => shop.openingBalance > 0).map((shop) => shop.openingBalance),
  );
  const owedByYou = sumPaise(
    activeShops
      .filter((shop) => shop.openingBalance < 0)
      .map((shop) => paise(Math.abs(shop.openingBalance))),
  );
  const net: Paise = paise(owedToYou - owedByYou);

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-xl font-bold text-ink">Dashboard</h1>
        <p className="mt-0.5 text-sm text-ink-2">
          {activeShops.length === 1 ? '1 active shop' : `${activeShops.length} active shops`}
        </p>
      </header>

      {error ? <Banner tone="debit">{error}</Banner> : null}

      <Card className="p-5">
        <div className="flex items-center gap-2">
          <Wallet size={15} className="text-ink-3" />
          <p className="text-sm font-semibold text-ink-2">Net opening position</p>
        </div>
        <p className="mt-2">
          <Amount value={net} tone="balance" size="xl" showPaise />
        </p>
        <p className="mt-1 text-sm text-ink-2">
          {net > 0
            ? 'owed to you across every active shop'
            : net < 0
              ? 'you owe across every active shop'
              : 'square across every active shop'}
        </p>

        <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-line pt-4">
          <div>
            <dt className="text-xs font-semibold tracking-wide text-ink-3 uppercase">
              Owed to you
            </dt>
            <dd className="mt-1">
              <Amount value={owedToYou} tone="credit" size="lg" />
            </dd>
          </div>
          <div>
            <dt className="text-xs font-semibold tracking-wide text-ink-3 uppercase">You owe</dt>
            <dd className="mt-1">
              <Amount value={owedByYou} tone="debit" size="lg" />
            </dd>
          </div>
        </dl>
      </Card>

      <section>
        <SectionHeading
          title="By shop"
          action={<Badge>Opening balances</Badge>}
          description="The figures you recorded as outstanding when each shop was added."
        />
        <Card>
          <ul>
            {activeShops.map((shop) => (
              <ShopRow key={shop.id} shop={shop} />
            ))}
          </ul>
        </Card>
      </section>

      <Banner tone="accent" title="What this screen does not show yet">
        <p className="flex gap-2">
          <Info size={15} className="mt-0.5 shrink-0" />
          <span>
            Salary, allowances, expenses, advances and payments arrive in the next phase, along
            with the running balance that combines them with the opening figures above. Until
            then this is the recorded starting position only — it is real, but it is not the
            whole picture.
          </span>
        </p>
      </Banner>

      {form}
    </div>
  );
}
