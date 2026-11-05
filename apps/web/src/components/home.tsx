'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { authClient } from '@/lib/auth-client';

type Workspace = { id: string; name: string; role: string };

export function Home() {
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
    return <main className="flex flex-1 items-center justify-center opacity-60">Loading…</main>;
  }

  return (
    <main className="mx-auto w-full max-w-3xl space-y-8 p-6">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">adelie</h1>
        <div className="flex items-center gap-4 text-sm">
          <span className="opacity-70">{session.user.email}</span>
          <button
            className="underline"
            onClick={async () => {
              await authClient.signOut();
              router.replace('/login');
            }}
          >
            Sign out
          </button>
        </div>
      </header>

      <section className="space-y-2">
        <h2 className="text-sm uppercase tracking-wide opacity-60">Workspaces</h2>
        {workspaces === null ? (
          <p className="opacity-60">Loading…</p>
        ) : workspaces.length === 0 ? (
          <p className="opacity-60">No workspaces.</p>
        ) : (
          <ul className="divide-y divide-black/10 dark:divide-white/10 rounded-md border border-black/10 dark:border-white/10">
            {workspaces.map((w) => (
              <li key={w.id} className="flex justify-between px-4 py-3">
                <span>{w.name}</span>
                <span className="text-sm opacity-60">{w.role.toLowerCase()}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
