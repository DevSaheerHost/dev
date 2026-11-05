/**
 * Asking a shop for what it owes.
 *
 * The message is built from the ledger and shown in full before anything
 * happens, because this is a message to someone the user works for every day —
 * it must never be sent on their behalf, or say anything they have not read.
 * Every route out of here hands the text to the phone's own apps:
 *
 *   SMS      an `sms:` link, prefilled, which opens the messaging app
 *   Call     a `tel:` link
 *   Share    the system share sheet, where WhatsApp usually is
 *   Copy     the clipboard, for everything else
 *
 * Nothing is sent from the app itself and nothing leaves the device here, so
 * there is no server, no delivery claim to make and nothing to go wrong in the
 * background.
 */

import { useState } from 'react';
import { Check, Copy, MessageSquare, Phone, Share2 } from 'lucide-react';

import { Banner, Button, Modal } from '@/components/ui';
import { buildBalanceMessage, formatPhone, smsHref, telHref } from '@/lib/contact';
import { formatDateLong, type CalendarDate } from '@/lib/dates';
import type { Paise } from '@/lib/money';
import type { Shop } from '@/types/models';

export function AskSheet({
  shop,
  balance,
  unconfirmed,
  personName,
  today,
  onClose,
  onEditShop,
}: {
  shop: Shop;
  balance: Paise;
  unconfirmed: Paise;
  personName: string;
  today: CalendarDate;
  onClose: () => void;
  /** Opens the shop form, for when there is no number to message. */
  onEditShop?: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [shareError, setShareError] = useState<string | null>(null);

  const message = buildBalanceMessage({
    shopName: shop.name,
    personName,
    balance,
    asOf: formatDateLong(today),
    unconfirmed,
  });

  const phone = shop.phone ?? '';
  const sms = smsHref(phone, message);
  const call = telHref(phone);
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';
  const canCopy = typeof navigator !== 'undefined' && navigator.clipboard != null;

  async function copy() {
    try {
      await navigator.clipboard.writeText(message);
      setCopied(true);
      setShareError(null);
    } catch {
      setShareError('Could not copy. Select the text above and copy it by hand.');
    }
  }

  async function share() {
    try {
      await navigator.share({ text: message });
      setShareError(null);
    } catch {
      // A cancelled share sheet rejects exactly like a failed one, so this says
      // nothing about why — it just leaves the message on screen.
      setShareError(null);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Ask for payment"
      footer={
        <Button tone="ghost" onClick={onClose} fullWidth>
          Close
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-sm text-ink-2">
          Read it, then pick how to send it. Nothing is sent until you do.
        </p>

        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-ink-2">The message</span>
          <textarea
            readOnly
            value={message}
            rows={8}
            className="w-full resize-none rounded-xl border border-line-strong bg-surface-2 px-3 py-2.5 text-sm leading-relaxed text-ink"
          />
        </label>

        {shop.phone ? (
          <p className="text-sm text-ink-3">
            To {shop.name} on {formatPhone(shop.phone)}
          </p>
        ) : (
          <Banner tone="neutral" title="No number saved for this shop">
            Add the owner's phone number and you can send this as a text or call them from here.
            {onEditShop ? (
              <span className="mt-2 block">
                <Button tone="neutral" onClick={onEditShop}>
                  Add a number
                </Button>
              </span>
            ) : null}
          </Banner>
        )}

        <div className="grid grid-cols-2 gap-2">
          {sms ? (
            <a
              href={sms}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-accent px-4 text-sm font-semibold text-accent-contrast hover:bg-accent-ink"
            >
              <MessageSquare size={15} />
              Send as SMS
            </a>
          ) : null}
          {call ? (
            <a
              href={call}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-line-strong bg-surface px-4 text-sm font-semibold text-ink hover:bg-surface-2"
            >
              <Phone size={15} />
              Call
            </a>
          ) : null}
          {canShare ? (
            <Button tone="neutral" onClick={() => void share()}>
              <Share2 size={15} />
              Share
            </Button>
          ) : null}
          {canCopy ? (
            <Button tone="neutral" onClick={() => void copy()}>
              {copied ? <Check size={15} /> : <Copy size={15} />}
              {copied ? 'Copied' : 'Copy'}
            </Button>
          ) : null}
        </div>

        {shareError ? <Banner tone="debit">{shareError}</Banner> : null}
      </div>
    </Modal>
  );
}
