'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';

type Preferences = Record<string, unknown>;
const SAVE_DELAY_MS = 500;

/**
 * The signed-in user's interface settings (`/me/preferences`), the same on every device. Changes
 * apply at once and are saved shortly after (rapid changes — e.g. dragging a column — make one
 * request); `null` resets a setting to the default. `prefs` is null until loaded.
 */
export function usePreferences() {
  const [prefs, setPrefs] = useState<Preferences | null>(null);
  /** Saves waiting for their delay: flushed when the page is left. */
  const pending = useRef(
    new Map<string, { timer: ReturnType<typeof setTimeout>; save: () => void }>(),
  );

  useEffect(() => {
    let cancelled = false;
    api<Preferences>('/me/preferences').then(
      (p) => !cancelled && setPrefs(p),
      // Settings are a convenience: without them the page works with the defaults.
      () => !cancelled && setPrefs({}),
    );
    const waiting = pending.current;
    return () => {
      cancelled = true;
      waiting.forEach(({ timer, save }) => {
        clearTimeout(timer);
        save();
      });
      waiting.clear();
    };
  }, []);

  const setPreference = useCallback((key: string, value: unknown | null) => {
    setPrefs((p) => {
      const next = { ...p };
      if (value === null) delete next[key];
      else next[key] = value;
      return next;
    });
    const path = `/me/preferences/${encodeURIComponent(key)}`;
    const save = () => {
      const request =
        value === null
          ? api(path, { method: 'DELETE' })
          : api(path, { method: 'PUT', json: value });
      request.catch(() => undefined);
    };
    clearTimeout(pending.current.get(key)?.timer);
    const timer = setTimeout(() => {
      pending.current.delete(key);
      save();
    }, SAVE_DELAY_MS);
    pending.current.set(key, { timer, save });
  }, []);

  return { prefs, setPreference };
}
