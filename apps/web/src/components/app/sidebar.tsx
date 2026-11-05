'use client';

import {
  FileChartColumn,
  Images,
  LayoutDashboard,
  PanelLeftClose,
  Settings,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { isSidebarCollapsed, setSidebarCollapsed } from '@/lib/theme';
import type { ReactNode } from 'react';

type NavKey = 'overview' | 'accounts' | 'content' | 'reports' | 'settings';

const NAV: { key: NavKey; href: string; icon: LucideIcon }[] = [
  { key: 'overview', href: '/', icon: LayoutDashboard },
  { key: 'accounts', href: '/accounts', icon: Users },
  { key: 'content', href: '/content', icon: Images },
  { key: 'reports', href: '/reports', icon: FileChartColumn },
  { key: 'settings', href: '/settings', icon: Settings },
];

/**
 * Left navigation on the base layer (no panel of its own). Expanded / collapsed state lives on
 * <html data-sidebar> (lib/theme.ts), so the width animates in CSS and survives reloads.
 */
export function Sidebar({
  onNavigate,
  collapsible = true,
  header,
}: {
  onNavigate?: () => void;
  collapsible?: boolean;
  /** Extra content on top (the mobile drawer shows the project switcher there). */
  header?: ReactNode;
}) {
  const t = useTranslations('Nav');
  const pathname = usePathname();

  return (
    <aside className="sidebar flex h-full flex-col gap-1 px-3 pb-1">
      {header}

      <nav className="flex flex-1 flex-col gap-2.5" aria-label={t('main')}>
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

      {collapsible && (
        <button
          type="button"
          onClick={() => setSidebarCollapsed(!isSidebarCollapsed())}
          data-tip={t('expand')}
          className="flex h-11 items-center rounded-2xl pr-3 text-sm text-muted transition-colors duration-200 hover:bg-hover hover:text-foreground"
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
    </aside>
  );
}
