'use client';

import { LogOut, UserRound } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { authClient } from '@/lib/auth-client';
import { Avatar } from './avatar';
import { useMe } from './me-context';

/** Avatar button in the top bar with a popover: who is signed in, personal settings, sign out. */
export function UserMenu({ user }: { user: { name: string; email: string } }) {
  const tAuth = useTranslations('Auth');
  const t = useTranslations('Profile');
  const router = useRouter();
  const { me } = useMe();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const name = me?.name || user.name || user.email;

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={name}
        className="flex rounded-full transition-transform duration-200 hover:scale-105"
      >
        <Avatar me={me} fallback={user} />
      </button>

      {open && (
        <div
          role="menu"
          className="glass glass-strong animate-rise absolute top-full right-0 z-40 mt-2 w-64 rounded-2xl p-2"
        >
          <div className="flex items-center gap-3 px-3 py-2">
            <Avatar me={me} fallback={user} size={40} />
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{name}</p>
              <p className="truncate text-xs text-muted">
                {me?.profile.jobTitle || me?.email || user.email}
              </p>
            </div>
          </div>
          <div className="my-1 h-px bg-line" />
          <Link
            href="/me"
            role="menuitem"
            onClick={() => setOpen(false)}
            className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm hover:bg-hover"
          >
            <UserRound size={16} strokeWidth={1.75} aria-hidden="true" />
            {t('menuItem')}
          </Link>
          <button
            type="button"
            role="menuitem"
            onClick={async () => {
              await authClient.signOut();
              router.replace('/login');
            }}
            className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm hover:bg-hover"
          >
            <LogOut size={16} strokeWidth={1.75} aria-hidden="true" />
            {tAuth('signOut')}
          </button>
        </div>
      )}
    </div>
  );
}
