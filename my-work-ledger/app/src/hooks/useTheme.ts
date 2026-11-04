/**
 * Theme selection.
 *
 * Three states: follow the system, force light, force dark. The choice is
 * written to the `data-theme` attribute on `<html>`, where the CSS in
 * `index.css` resolves it — so no component carries a `dark:` variant and the
 * two forced states share the same token definitions as the automatic one.
 */

import { useCallback, useEffect, useState } from 'react';

export type ThemeChoice = 'system' | 'light' | 'dark';

const STORAGE_KEY = 'work-ledger:theme';

function readStored(): ThemeChoice {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    if (value === 'light' || value === 'dark' || value === 'system') return value;
  } catch {
    // Storage is unavailable in private windows and some WebViews. Following
    // the system is a safe default, so the failure is silent.
  }
  return 'system';
}

function applyTheme(choice: ThemeChoice): void {
  const root = document.documentElement;
  if (choice === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', choice);
}

export function useTheme(): { theme: ThemeChoice; setTheme: (next: ThemeChoice) => void } {
  const [theme, setThemeState] = useState<ThemeChoice>(readStored);

  // The attribute is a DOM side effect of the chosen value, so it belongs in an
  // effect rather than in the setter: a theme restored from storage on first
  // paint has to reach the DOM too.
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const setTheme = useCallback((next: ThemeChoice) => {
    setThemeState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // See readStored.
    }
  }, []);

  return { theme, setTheme };
}
