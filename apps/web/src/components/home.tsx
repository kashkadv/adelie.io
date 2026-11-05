'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { authClient } from '@/lib/auth-client';
import { AppShell } from './app-shell';

type Role = 'OWNER' | 'ADMIN' | 'ANALYST' | 'VIEWER';
type Workspace = { id: string; name: string; role: Role };

export function Home() {
  const t = useTranslations('Home');
  const tAuth = useTranslations('Auth');
  const tCommon = useTranslations('Common');
  const router = useRouter();
  const { data: session, isPending } = authClient.useSession();
  const [workspaces, setWorkspaces] = useState<Workspace[] | null>(null);

  useEffect(() => {
    if (isPending) return;
    if (!session) {
      router.replace('/login');
      return;
    }
    api<Workspace[]>('/workspaces').then(setWorkspaces, () => setWorkspaces([]));
  }, [isPending, session, router]);

  if (isPending || !session) {
    return (
      <main className="flex flex-1 items-center justify-center opacity-60">
        {tCommon('loading')}
      </main>
    );
  }

  return (
    <AppShell
      headerRight={
        <>
          <span className="opacity-70">{session.user.email}</span>
          <button
            className="underline"
            onClick={async () => {
              await authClient.signOut();
              router.replace('/login');
            }}
          >
            {tAuth('signOut')}
          </button>
        </>
      }
    >
      <section className="space-y-2">
        <h2 className="text-sm uppercase tracking-wide opacity-60">{t('workspaces')}</h2>
        {workspaces === null ? (
          <p className="opacity-60">{tCommon('loading')}</p>
        ) : workspaces.length === 0 ? (
          <p className="opacity-60">{t('noWorkspaces')}</p>
        ) : (
          <ul className="divide-y divide-line rounded-md border border-line">
            {workspaces.map((w) => (
              <li key={w.id} className="flex justify-between px-4 py-3">
                <span>{w.name}</span>
                <span className="text-sm opacity-60">{t(`roles.${w.role}`)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </AppShell>
  );
}
