/**
 * Routing and page composition. Deliberately thin: state lives in stores and
 * hooks, the interface lives in components and pages.
 */

import { useEffect, useState } from 'react';

import { AppShell } from '@/components/AppShell';
import { ToastProvider } from '@/components/Toast';
import { useHashRoute } from '@/hooks/useHashRoute';
import { useItems } from '@/hooks/useItems';
import { DEFAULT_RETENTION } from '@/lib/constants';
import { HistoryPage } from '@/pages/HistoryPage';
import { HomePage } from '@/pages/HomePage';
import { SettingsPage } from '@/pages/SettingsPage';
import { TransferPage } from '@/pages/TransferPage';
import { WorkspacePage } from '@/pages/WorkspacePage';
import { SETTING_KEYS, readSetting, writeSetting } from '@/storage/db';
import { DraftProvider } from '@/stores/draft';
import { WorkspaceProvider } from '@/stores/workspace';
import type { RetentionId } from '@/types';

function Routes() {
  const [route, navigate] = useHashRoute();
  const items = useItems();
  const [retention, setRetention] = useState<RetentionId>(DEFAULT_RETENTION);

  useEffect(() => {
    void readSetting<RetentionId>(SETTING_KEYS.retention, DEFAULT_RETENTION).then(setRetention);
  }, []);

  const changeRetention = (value: RetentionId) => {
    setRetention(value);
    void writeSetting(SETTING_KEYS.retention, value);
  };

  return (
    <AppShell route={route.name} onNavigate={navigate} status={items.status}>
      {route.name === 'home' && (
        <HomePage
          items={items}
          retention={retention}
          onRetentionChange={changeRetention}
          onNavigate={navigate}
        />
      )}
      {route.name === 'history' && <HistoryPage items={items} />}
      {route.name === 'transfer' && <TransferPage onNavigate={navigate} />}
      {route.name === 'workspace' && (
        <WorkspacePage joinSecret={route.params.get('join') ?? undefined} />
      )}
      {route.name === 'settings' && (
        <SettingsPage retention={retention} onRetentionChange={changeRetention} />
      )}
    </AppShell>
  );
}

export default function App() {
  return (
    <ToastProvider>
      <WorkspaceProvider>
        <DraftProvider>
          <Routes />
        </DraftProvider>
      </WorkspaceProvider>
    </ToastProvider>
  );
}
