'use client';

import { LogOut } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { authClient } from '@/lib/auth-client';

function initials(name: string, email: string): string {
  const parts = (name.trim() || email).split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '?';
}

/** Avatar button in the top bar with a popover: who is signed in + sign out. */
export function UserMenu({ user }: { user: { name: string; email: string } }) {
  const tAuth = useTranslations('Auth');
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

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
        aria-label={user.name || user.email}
        className="flex h-9 w-9 items-center justify-center rounded-full bg-accent text-xs font-semibold text-accent-foreground transition-transform duration-200 hover:scale-105"
      >
        {initials(user.name, user.email)}
      </button>

      {open && (
        <div
          role="menu"
          className="glass glass-strong animate-rise absolute top-full right-0 z-40 mt-2 w-64 rounded-2xl p-2"
        >
          <div className="px-3 py-2">
            <p className="truncate text-sm font-medium">{user.name || user.email}</p>
            <p className="truncate text-xs text-muted">{user.email}</p>
          </div>
          <div className="my-1 h-px bg-line" />
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
