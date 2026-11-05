'use client';

import {
  FileChartColumn,
  Images,
  LayoutDashboard,
  LogOut,
  PanelLeftClose,
  Settings,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { authClient } from '@/lib/auth-client';
import { isSidebarCollapsed, setSidebarCollapsed } from '@/lib/theme';
import { BrandMark } from '../brand';
import { LocaleSwitcher } from '../locale-switcher';
import { ThemeToggle } from '../theme-toggle';
import { ProjectSwitcher } from './project-switcher';

type NavKey = 'overview' | 'accounts' | 'content' | 'reports' | 'settings';

const NAV: { key: NavKey; href: string; icon: LucideIcon }[] = [
  { key: 'overview', href: '/', icon: LayoutDashboard },
  { key: 'accounts', href: '/accounts', icon: Users },
  { key: 'content', href: '/content', icon: Images },
  { key: 'reports', href: '/reports', icon: FileChartColumn },
  { key: 'settings', href: '/settings', icon: Settings },
];

function initials(name: string, email: string): string {
  const source = name.trim() || email;
  const parts = source.split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '?';
}

/**
 * Left navigation. Expanded / collapsed state lives on <html data-sidebar> (see lib/theme.ts),
 * so the width animates in CSS and survives reloads without a flash.
 */
export function Sidebar({
  user,
  onNavigate,
  collapsible = true,
}: {
  user: { name: string; email: string };
  onNavigate?: () => void;
  collapsible?: boolean;
}) {
  const t = useTranslations('Nav');
  const tAuth = useTranslations('Auth');
  const pathname = usePathname();
  const router = useRouter();

  return (
    <aside className="sidebar glass flex h-full flex-col gap-2 rounded-[28px] p-3">
      {/* Brand */}
      <Link href="/" onClick={onNavigate} className="flex h-12 items-center" aria-label="Adelie">
        <span className="slot">
          <BrandMark className="h-7 w-6" />
        </span>
        <span className="label wordmark text-xl">Adelie</span>
      </Link>

      <div className="mx-2 h-px bg-line" />

      <ProjectSwitcher />

      {/* Navigation */}
      <nav className="mt-2 flex flex-1 flex-col gap-1" aria-label={t('main')}>
        {NAV.map(({ key, href, icon: Icon }) => {
          const active = href === '/' ? pathname === '/' : pathname.startsWith(href);
          return (
            <Link
              key={key}
              href={href}
              onClick={onNavigate}
              aria-current={active ? 'page' : undefined}
              data-tip={t(key)}
              className={`flex h-11 items-center rounded-2xl pr-3 text-sm transition-[background-color,color,box-shadow] duration-300 ease-(--ease-soft) ${
                active
                  ? 'bg-accent font-medium text-accent-foreground shadow-[0_8px_24px_-10px_var(--shadow)]'
                  : 'text-muted hover:bg-hover hover:text-foreground'
              }`}
            >
              <span className="slot">
                <Icon size={20} strokeWidth={1.75} aria-hidden="true" />
              </span>
              <span className="label">{t(key)}</span>
            </Link>
          );
        })}
      </nav>

      {/* Preferences */}
      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center">
          <span className="slot h-10">
            <ThemeToggle />
          </span>
          <span className="slot h-10">
            <LocaleSwitcher />
          </span>
        </div>
        {collapsible && (
          <button
            type="button"
            onClick={() => setSidebarCollapsed(!isSidebarCollapsed())}
            data-tip={t('expand')}
            className="flex h-10 items-center rounded-2xl pr-3 text-sm text-muted transition-colors duration-200 hover:bg-hover hover:text-foreground"
          >
            <span className="slot">
              <PanelLeftClose
                className="collapse-icon"
                size={20}
                strokeWidth={1.75}
                aria-hidden="true"
              />
            </span>
            <span className="label">{t('collapse')}</span>
            <span className="sr-only">{t('toggleSidebar')}</span>
          </button>
        )}
      </div>

      <div className="mx-2 h-px bg-line" />

      {/* Profile */}
      <div className="flex items-center py-1.5">
        <span className="slot" data-tip={user.email}>
          <span className="flex h-9 w-9 items-center justify-center rounded-full border border-line text-xs font-semibold">
            {initials(user.name, user.email)}
          </span>
        </span>
        <span className="label min-w-0 flex-1 pr-1">
          <span className="block truncate text-sm font-medium">{user.name || user.email}</span>
          <span className="block truncate text-xs text-muted">{user.email}</span>
        </span>
        <button
          type="button"
          className="icon-btn label"
          aria-label={tAuth('signOut')}
          title={tAuth('signOut')}
          onClick={async () => {
            await authClient.signOut();
            router.replace('/login');
          }}
        >
          <LogOut size={18} strokeWidth={1.75} aria-hidden="true" />
        </button>
      </div>
    </aside>
  );
}
