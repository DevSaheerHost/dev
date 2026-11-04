/**
 * Whether the browser believes it has a connection.
 *
 * `navigator.onLine` is a hint, not a guarantee — it reports a connected
 * interface, not a reachable Firestore. It is good enough for the one thing it
 * is used for: telling the user that an entry is saved on the device and will
 * sync, rather than leaving them wondering whether it was lost.
 */

import { useEffect, useState } from 'react';

export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState(() =>
    typeof navigator === 'undefined' ? true : navigator.onLine,
  );

  useEffect(() => {
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  return online;
}
