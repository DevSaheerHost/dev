import { useState } from 'react';

import { DirectTransfer } from '@/components/DirectTransfer';
import { QrReceiverPanel, QrSender } from '@/components/QrTransfer';
import { Button, Card, cx } from '@/components/ui';
import { useToast } from '@/components/Toast';
import { useDraft } from '@/stores/draft';
import type { RouteName } from '@/hooks/useHashRoute';

type Method = 'sync' | 'qr-show' | 'qr-scan' | 'direct';

const METHODS: Array<{ id: Method; label: string; description: string }> = [
  { id: 'sync', label: 'Save & Sync', description: 'Send it through this workspace. Simplest, works everywhere.' },
  { id: 'qr-show', label: 'QR Transfer', description: 'Show codes on this screen for another browser to scan. No network needed.' },
  { id: 'qr-scan', label: 'Scan QR', description: 'Use this browser’s camera to receive from another screen.' },
  { id: 'direct', label: 'Direct Transfer', description: 'Connect the two browsers and send the bytes straight across.' },
];

export function TransferPage({ onNavigate }: { onNavigate: (route: RouteName) => void }) {
  const draft = useDraft();
  const { notify } = useToast();
  const [method, setMethod] = useState<Method>('qr-show');
  const [text, setText] = useState(() => draft.getText());

  return (
    <div className="grid gap-5">
      <Card className="p-2">
        <div role="tablist" aria-label="Transfer method" className="grid gap-1 sm:grid-cols-4">
          {METHODS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              role="tab"
              aria-selected={method === entry.id}
              onClick={() => {
                setMethod(entry.id);
                if (entry.id === 'qr-show') setText(draft.getText());
                if (entry.id === 'sync') onNavigate('home');
              }}
              className={cx(
                'grid content-start gap-1 rounded-xl px-4 py-3 text-left transition-colors',
                method === entry.id ? 'bg-accent-soft' : 'hover:bg-surface-2',
              )}
            >
              <span
                className={cx(
                  'text-[13.5px] font-semibold',
                  method === entry.id ? 'text-accent-ink' : 'text-ink',
                )}
              >
                {entry.label}
              </span>
              <span className="text-[12px] leading-snug text-ink-3">{entry.description}</span>
            </button>
          ))}
        </div>
      </Card>

      {method === 'qr-show' && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              onClick={() => {
                setText(draft.getText());
                notify('Using the current composer text.');
              }}
            >
              Refresh from composer
            </Button>
            <Button size="sm" variant="ghost" onClick={() => onNavigate('home')}>
              Edit text
            </Button>
          </div>
          <QrSender text={text} />
        </>
      )}

      {method === 'qr-scan' && (
        <QrReceiverPanel
          onComplete={(received) => {
            draft.setText(received);
            notify('Text placed in the composer.', 'success');
          }}
        />
      )}

      {method === 'direct' && <DirectTransfer getText={draft.getText} file={draft.file} />}
    </div>
  );
}
