/**
 * The shop switcher in the header.
 *
 * A menu rather than a `<select>`: the trigger has to show the current shop's
 * name truncated to whatever width is left after the title, and a native select
 * cannot be truncated reliably across platforms. It collapses to nothing when
 * there is only one shop, because a switcher with one option is just clutter.
 */

import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, Store } from 'lucide-react';

import { useShops } from './ShopsProvider';

export function ShopSwitcher() {
  const { activeShops, selectedShop, selectShop } = useShops();
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  if (activeShops.length < 2 || !selectedShop) return null;

  return (
    <div ref={container} className="relative min-w-0">
      <button
        type="button"
        onClick={() => setOpen((previous) => !previous)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="flex min-h-10 w-full min-w-0 items-center gap-1.5 rounded-xl border border-line-strong bg-surface px-2.5 text-sm font-semibold text-ink hover:bg-surface-2"
      >
        <Store size={15} className="shrink-0 text-ink-3" />
        <span className="truncate">{selectedShop.name}</span>
        <ChevronDown size={15} className="shrink-0 text-ink-3" />
      </button>

      {open ? (
        <div
          role="menu"
          className="absolute right-0 z-40 mt-1.5 max-h-72 w-60 overflow-y-auto rounded-xl border border-line bg-surface p-1 shadow-float"
        >
          {activeShops.map((shop) => {
            const current = shop.id === selectedShop.id;
            return (
              <button
                key={shop.id}
                type="button"
                role="menuitemradio"
                aria-checked={current}
                onClick={() => {
                  selectShop(shop.id);
                  setOpen(false);
                }}
                className={`flex min-h-11 w-full items-center justify-between gap-2 rounded-lg px-3 text-left text-sm ${
                  current ? 'bg-accent-soft font-semibold text-accent-ink' : 'text-ink hover:bg-surface-2'
                }`}
              >
                <span className="truncate">{shop.name}</span>
                {current ? <Check size={15} className="shrink-0" /> : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
