'use client';

import {
  CalendarDays,
  FileChartColumn,
  Waves,
  Images,
  ChartColumn,
  House,
  Link2,
  Package,
  PanelLeftClose,
  PlugZap,
  Telescope,
  ReceiptText,
  Settings,
  type LucideIcon,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { isSidebarCollapsed, setSidebarCollapsed } from '@/lib/theme';
import {
  useEffect,
  useRef,
  useState,
  type FocusEvent,
  type MouseEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';

type NavKey =
  | 'home'
  | 'statistics'
  | 'content'
  | 'links'
  | 'calendar'
  | 'research'
  | 'products'
  | 'orders'
  | 'flipper'
  | 'reports'
  | 'connections'
  | 'settings';
type NavItem = { key: NavKey; href: string; icon: LucideIcon };

/**
 * Sections by the question they answer (ADR-0018): Promotion — "where am I seen and what comes of
 * it?", Sales — "what do people buy?". Connections are set-up, not a place for analysis.
 */
const NAV: { group?: 'promotion' | 'sales' | 'site'; items: NavItem[] }[] = [
  {
    items: [
      { key: 'home', href: '/', icon: House },
      { key: 'statistics', href: '/statistics', icon: ChartColumn },
    ],
  },
  {
    group: 'promotion',
    items: [
      { key: 'content', href: '/content', icon: Images },
      // Tracked links (ADR-0027).
      { key: 'links', href: '/links', icon: Link2 },
      // Content calendar and weekly review (ADR-0028).
      { key: 'calendar', href: '/calendar', icon: CalendarDays },
      // Niche research: what to promote and how to write it (ADR-0032).
      { key: 'research', href: '/research', icon: Telescope },
    ],
  },
  {
    group: 'sales',
    items: [
      { key: 'products', href: '/products', icon: Package },
      { key: 'orders', href: '/orders', icon: ReceiptText },
    ],
  },
  // Flipper: what visitors do on the site (ADR-0022).
  { group: 'site', items: [{ key: 'flipper', href: '/flipper', icon: Waves }] },
  {
    items: [
      { key: 'reports', href: '/reports', icon: FileChartColumn },
      { key: 'connections', href: '/connections', icon: PlugZap },
      { key: 'settings', href: '/settings', icon: Settings },
    ],
  },
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
  // On a short screen the menu scrolls (without a visible bar); a soft fade at an edge says there
  // is more above or below.
  const navRef = useRef<HTMLElement>(null);
  const [more, setMore] = useState<'none' | 'top' | 'bottom' | 'both'>('none');
  // Collapsed, an item's name shows beside it — drawn over the page, as the scrolling menu clips.
  const [tip, setTip] = useState<{ text: string; top: number; left: number } | null>(null);
  const showTip = (e: MouseEvent<HTMLElement> | FocusEvent<HTMLElement>, text: string) => {
    if (!isSidebarCollapsed()) return;
    const r = e.currentTarget.getBoundingClientRect();
    setTip({ text, top: r.top + r.height / 2, left: r.right + 12 });
  };
  useEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    const update = () => {
      const top = nav.scrollTop > 2;
      const bottom = nav.scrollTop + nav.clientHeight < nav.scrollHeight - 2;
      setMore(top && bottom ? 'both' : top ? 'top' : bottom ? 'bottom' : 'none');
    };
    update();
    nav.addEventListener('scroll', update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(nav);
    return () => {
      nav.removeEventListener('scroll', update);
      observer.disconnect();
    };
  }, []);

  return (
    <aside className="sidebar flex h-full flex-col gap-1 px-3 pb-1">
      {header}

      <nav
        ref={navRef}
        data-more={more}
        className="sidebar-scroll flex min-h-0 flex-1 flex-col gap-2.5 overflow-x-hidden overflow-y-auto *:shrink-0"
        aria-label={t('main')}
      >
        {NAV.flatMap(({ group, items }, i) => [
          ...(group || i > 0
            ? [
                // Group title; collapsed, only a hairline marks where a group starts.
                <p key={`g${i}`} className="nav-group" role="presentation">
                  {group && <span className="label">{t(`groups.${group}`)}</span>}
                </p>,
              ]
            : []),
          ...items.map(({ key, href, icon: Icon }) => {
            const active = href === '/' ? pathname === '/' : pathname.startsWith(href);
            return (
              <Link
                key={key}
                href={href}
                onClick={onNavigate}
                aria-current={active ? 'page' : undefined}
                aria-label={t(key)}
                onMouseEnter={(e) => showTip(e, t(key))}
                onMouseLeave={() => setTip(null)}
                onFocus={(e) => showTip(e, t(key))}
                onBlur={() => setTip(null)}
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
          }),
        ])}
      </nav>
      {tip &&
        createPortal(
          <span
            role="tooltip"
            className="sidebar-tip pointer-events-none fixed z-[95] rounded-[10px] bg-accent px-2.5 py-1.5 text-[13px] whitespace-nowrap text-accent-foreground shadow-[0_8px_24px_-8px_var(--shadow)]"
            style={{ top: tip.top, left: tip.left }}
          >
            {tip.text}
          </span>,
          document.body,
        )}

      {collapsible && (
        <button
          type="button"
          onClick={() => setSidebarCollapsed(!isSidebarCollapsed())}
          data-tip={t('expand')}
          className="flex h-11 shrink-0 items-center rounded-2xl pr-3 text-sm text-muted transition-colors duration-200 hover:bg-hover hover:text-foreground"
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
