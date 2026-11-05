'use client';

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api } from '@/lib/api';
import { apiUrl } from '@/lib/auth-client';

export type Profile = {
  firstName?: string | null;
  lastName?: string | null;
  jobTitle?: string | null;
  contactEmail?: string | null;
  phone?: string | null;
  telegram?: string | null;
  whatsapp?: string | null;
  viber?: string | null;
  linkedin?: string | null;
  timezone?: string | null;
  workDays: number[];
  workStart?: string | null;
  workEnd?: string | null;
  avatarUpdatedAt?: string | null;
};

export type Me = { id: string; email: string; name: string; profile: Profile };

type MeState = { me: Me | null; setMe: (me: Me) => void; reload: () => Promise<void> };

const MeContext = createContext<MeState | null>(null);

/** The signed-in user's personal profile (ADR-0010), shared by the user menu and /me. */
export function MeProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const reload = useCallback(async () => setMe(await api<Me>('/me/profile')), []);

  useEffect(() => {
    api<Me>('/me/profile').then(setMe, () => undefined);
  }, []);

  return <MeContext.Provider value={{ me, setMe, reload }}>{children}</MeContext.Provider>;
}

export function useMe(): MeState {
  const value = useContext(MeContext);
  if (!value) throw new Error('useMe must be used inside <MeProvider>');
  return value;
}

/** Cache-busted avatar URL, or null when the user has no photo. */
export function avatarUrl(me: Pick<Me, 'id' | 'profile'>): string | null {
  const v = me.profile.avatarUpdatedAt;
  return v ? `${apiUrl}/users/${me.id}/avatar?v=${encodeURIComponent(v)}` : null;
}

export function initials(name: string, email: string): string {
  const parts = (name.trim() || email).split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '?';
}
