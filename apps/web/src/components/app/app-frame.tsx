'use client';

import { Menu } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { authClient } from '@/lib/auth-client';
import { BrandMark } from '../brand';
import { Sidebar } from './sidebar';
import { WorkspaceProvider } from './workspace-context';

/**
 * Full-screen app frame: glass sidebar on the left, scrollable content on the right.
 * On small screens the sidebar becomes a drawer opened from the top bar.
 * Redirects to /login without a session.
 */
export function AppFrame({ children }: { children: ReactNode }) {
  const t = useTranslations('Nav');
  const tCommon = useTranslations('Common');
  const router = useRouter();
  const { data: session, isPending } = authClient.useSession();
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    if (!isPending && !session) router.replace('/login');
  }, [isPending, session, router]);

  if (isPending || !session) {
    return (
      <div className="flex h-dvh items-center justify-center text-muted">
        <BrandMark className="h-10 w-9 animate-pulse" />
        <span className="sr-only">{tCommon('loading')}</span>
      </div>
    );
  }

  const user = { name: session.user.name, email: session.user.email };

  return (
    <WorkspaceProvider>
      <div className="flex h-dvh gap-3 p-3">
        {/* Desktop sidebar */}
        <div className="hidden md:block">
          <Sidebar user={user} />
        </div>

        {/* Mobile drawer */}
        {drawerOpen && (
          <div className="fixed inset-0 z-50 md:hidden">
            <button
              type="button"
              aria-label={t('closeMenu')}
              className="absolute inset-0 bg-black/30 backdrop-blur-sm"
              onClick={() => setDrawerOpen(false)}
            />
            <div className="sidebar-drawer animate-rise absolute inset-y-3 left-3">
              <Sidebar user={user} collapsible={false} onNavigate={() => setDrawerOpen(false)} />
            </div>
          </div>
        )}

        <div className="flex min-w-0 flex-1 flex-col gap-3">
          {/* Mobile top bar */}
          <header className="glass flex h-14 items-center justify-between rounded-[22px] px-3 md:hidden">
            <button
              type="button"
              className="icon-btn"
              aria-label={t('openMenu')}
              onClick={() => setDrawerOpen(true)}
            >
              <Menu size={20} strokeWidth={1.75} aria-hidden="true" />
            </button>
            <span className="flex items-center gap-2">
              <BrandMark className="h-6 w-5" />
              <span className="wordmark text-lg">Adelie</span>
            </span>
            <span className="w-9" aria-hidden="true" />
          </header>

          <main className="min-h-0 flex-1 overflow-y-auto rounded-[28px]">
            <div className="w-full px-1 py-2 md:px-3 md:py-3">{children}</div>
          </main>
        </div>
      </div>
    </WorkspaceProvider>
  );
}
