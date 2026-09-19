import { useCallback, useEffect, useState } from 'react';
import { SETTING_KEYS, readSetting, writeSetting } from '@/storage/db';

export type ThemeChoice = 'system' | 'light' | 'dark';

function apply(choice: ThemeChoice): void {
  const root = document.documentElement;
  if (choice === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', choice);
}

/** Theme preference, persisted in IndexedDB alongside the rest of the state. */
export function useTheme() {
  const [theme, setTheme] = useState<ThemeChoice>('system');

  useEffect(() => {
    void readSetting<ThemeChoice>(SETTING_KEYS.theme, 'system').then((stored) => {
      setTheme(stored);
      apply(stored);
    });
  }, []);

  const change = useCallback((choice: ThemeChoice) => {
    setTheme(choice);
    apply(choice);
    void writeSetting(SETTING_KEYS.theme, choice);
  }, []);

  return { theme, setTheme: change };
}
