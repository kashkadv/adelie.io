'use client';

import { useCallback, useSyncExternalStore } from 'react';

const EVENT = 'adelie-stored-flag';

/**
 * A boolean UI preference remembered in this browser (localStorage). The server renders the
 * default; the browser then shows the stored value without a hydration mismatch.
 */
export function useStoredFlag(key: string, fallback: boolean): [boolean, (value: boolean) => void] {
  const read = useCallback(() => {
    try {
      const v = localStorage.getItem(key);
      return v === null ? fallback : v === '1';
    } catch {
      return fallback;
    }
  }, [key, fallback]);

  const value = useSyncExternalStore(
    (notify) => {
      window.addEventListener(EVENT, notify);
      window.addEventListener('storage', notify);
      return () => {
        window.removeEventListener(EVENT, notify);
        window.removeEventListener('storage', notify);
      };
    },
    read,
    () => fallback,
  );

  const set = useCallback(
    (next: boolean) => {
      try {
        localStorage.setItem(key, next ? '1' : '0');
      } catch {
        // Storage unavailable: the choice still applies until reload.
      }
      window.dispatchEvent(new Event(EVENT));
    },
    [key],
  );

  return [value, set];
}
