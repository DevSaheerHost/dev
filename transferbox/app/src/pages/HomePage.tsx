import { useState } from 'react';

import { Composer } from '@/components/Composer';
import { ItemList } from '@/components/ItemList';
import { Badge, Button, Card, CardHeader } from '@/components/ui';
import type { RouteName } from '@/hooks/useHashRoute';
import type { useItems } from '@/hooks/useItems';
import { useWorkspace } from '@/stores/workspace';
import { useDraft } from '@/stores/draft';
import type { Progress, RetentionId } from '@/types';

export function HomePage({
  items,
  retention,
  onRetentionChange,
  onNavigate,
}: {
  items: ReturnType<typeof useItems>;
  retention: RetentionId;
  onRetentionChange: (value: RetentionId) => void;
  onNavigate: (route: RouteName) => void;
}) {
  const { workspace } = useWorkspace();
  const draft = useDraft();
  const [progress, setProgress] = useState<Progress | null>(null);
  const [busy, setBusy] = useState(false);

  const withProgress = async (run: () => Promise<void>) => {
    setBusy(true);
    setProgress(null);
    try {
      await run();
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  const recent = items.items.slice(0, 6);

  return (
    <div className="grid gap-5">
      {workspace.kind === 'public' ? (
        <Card className="flex flex-wrap items-center gap-x-4 gap-y-2 border-warn/25 bg-warn-soft px-5 py-3.5">
          <Badge tone="warn">Public workspace</Badge>
          <p className="min-w-0 flex-1 text-[13px] leading-snug text-ink-2">
            Anyone with access to this workspace can view the items shared here. Nothing in it is
            private.
          </p>
          <Button size="sm" onClick={() => onNavigate('workspace')}>
            Create a private one
          </Button>
        </Card>
      ) : (
        <Card className="flex flex-wrap items-center gap-x-4 gap-y-2 border-good/25 bg-good-soft px-5 py-3.5">
          <Badge tone="good">Private · {workspace.label}</Badge>
          <p className="min-w-0 flex-1 text-[13px] leading-snug text-ink-2">
            Items here are encrypted on this device before upload. Only browsers holding the
            workspace link can read them.
          </p>
          <Button size="sm" onClick={() => onNavigate('workspace')}>
            Share workspace
          </Button>
        </Card>
      )}

      <Composer
        retention={retention}
        onRetentionChange={onRetentionChange}
        onSaveText={(text) => withProgress(() => items.addText(text, { retention, onProgress: setProgress }))}
        onSaveFile={(file) => withProgress(() => items.addFile(file, { retention, onProgress: setProgress }))}
        onQrTransfer={() => onNavigate('transfer')}
        onDirectTransfer={() => onNavigate('transfer')}
        progress={progress}
        busy={busy}
      />

      <Card className="overflow-hidden">
        <CardHeader
          title="Recent"
          description="The newest items in this workspace."
          action={
            <Button size="sm" variant="ghost" onClick={() => onNavigate('history')}>
              View all
            </Button>
          }
        />
        <ItemList
          items={recent}
          pending={items.pending}
          loading={items.loading}
          onDelete={(item) => void items.removeItem(item)}
          onDiscardPending={(id) => void items.discardPending(id)}
          emptyAction={
            <Button size="sm" onClick={() => draft.setText('Hello from TransferBox')}>
              Try it with a sample
            </Button>
          }
        />
      </Card>
    </div>
  );
}
