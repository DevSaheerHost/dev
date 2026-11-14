/**
 * The Android hardware back button.
 *
 * Without this the WebView's default takes over and back closes the app from
 * anywhere, including from inside a shop — which on a phone feels like losing
 * your place rather than going back one step.
 *
 * The rule here is the one Android users expect:
 *
 *   inside a shop or a tab   →  go back through the history
 *   on the dashboard         →  put the app in the background
 *
 * Backgrounding rather than exiting: the ledger's listeners and the Firestore
 * cache stay warm, so coming back is instant, and nothing is lost if the user
 * pressed back by mistake. Android still reclaims the process when it needs to.
 *
 * A no-op on the web, where there is no hardware back button to intercept.
 */

import { useEffect } from 'react';

export function useAndroidBackButton(): void {
  useEffect(() => {
    let detach: (() => void) | undefined;
    let cancelled = false;

    void (async () => {
      try {
        const { Capacitor } = await import('@capacitor/core');
        if (!Capacitor.isNativePlatform()) return;

        const { App } = await import('@capacitor/app');
        const handle = await App.addListener('backButton', ({ canGoBack }) => {
          // A dialog is its own step back: closing it is what the user means,
          // and every dialog in this app closes on Escape.
          const dialog = document.querySelector('[role="dialog"]');
          if (dialog) {
            window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
            return;
          }

          if (canGoBack && window.location.hash !== '#/dashboard') {
            window.history.back();
            return;
          }

          if (window.location.hash !== '#/dashboard' && window.location.hash !== '') {
            window.location.hash = '#/dashboard';
            return;
          }

          void App.minimizeApp();
        });

        if (cancelled) void handle.remove();
        else detach = () => void handle.remove();
      } catch {
        // Not a native build, or the plugin is unavailable. The browser's own
        // back button already does the right thing.
      }
    })();

    return () => {
      cancelled = true;
      detach?.();
    };
  }, []);
}
