'use client';

import { Menu } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { authClient } from '@/lib/auth-client';
import { BrandMark } from '../brand';
import { LocaleSwitcher } from '../locale-switcher';
import { ThemeToggle } from '../theme-toggle';
import { ProjectSwitcher } from './project-switcher';
import { Sidebar } from './sidebar';
import { UserMenu } from './user-menu';
import { WorkspaceProvider } from './workspace-context';

/**
 * Full-screen app frame in two layers (ADR-0009):
 * - base layer: top bar (brand left; theme, language, profile right) and the sidebar;
 * - raised layer: the content viewport — a single panel with its own scroll.
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
      <div className="flex h-dvh flex-col px-3 pb-3 md:px-8 md:pb-8">
        {/* Top bar (base layer) */}
        <header className="flex h-16 shrink-0 items-center md:h-[88px]">
          <button
            type="button"
            className="icon-btn md:hidden"
            aria-label={t('openMenu')}
            onClick={() => setDrawerOpen(true)}
          >
            <Menu size={20} strokeWidth={1.75} aria-hidden="true" />
          </button>
          {/* Same width as the sidebar, so the mark sits right above the nav icons. */}
          <Link
            href="/"
            className="sidebar hidden h-full items-center px-3 md:flex"
            aria-label="Adelie"
          >
            <span className="slot">
              <BrandMark className="h-7 w-6" />
            </span>
            <span className="label wordmark text-[30px]">Adelie</span>
          </Link>
          {/* Project switcher above the content panel: gap (24px) + corner radius (32px). */}
          <div className="hidden min-w-0 md:ml-14 md:block">
            <ProjectSwitcher />
          </div>
          <Link href="/" className="ml-2 flex items-center gap-2 md:hidden" aria-label="Adelie">
            <BrandMark className="h-6 w-5" />
            <span className="wordmark text-[26px]">Adelie</span>
          </Link>

          {/* Ends where the content panel's top-right corner radius (32px) begins. */}
          <div className="ml-auto flex items-center gap-1 md:mr-8">
            <ThemeToggle />
            <LocaleSwitcher />
            <span className="ml-2">
              <UserMenu user={user} />
            </span>
          </div>
        </header>

        <div className="flex min-h-0 flex-1">
          {/* Sidebar (base layer); starts where the content panel's top corner radius (32px) ends. */}
          <div className="hidden pt-8 md:block">
            <Sidebar />
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
              <div className="sidebar-drawer content-panel animate-rise absolute inset-y-3 left-3 rounded-[28px] py-3">
                <Sidebar
                  collapsible={false}
                  onNavigate={() => setDrawerOpen(false)}
                  header={
                    <div className="mb-3">
                      <ProjectSwitcher />
                    </div>
                  }
                />
              </div>
            </div>
          )}

          {/* Content viewport (raised layer) */}
          <main className="content-panel min-w-0 flex-1 overflow-y-auto rounded-[32px] md:ml-6">
            <div className="w-full p-5 md:p-8">{children}</div>
          </main>
        </div>
      </div>
    </WorkspaceProvider>
  );
}
