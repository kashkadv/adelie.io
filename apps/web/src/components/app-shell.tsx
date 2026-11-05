'use client';

import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { LocaleSwitcher } from './locale-switcher';
import { ThemeToggle } from './theme-toggle';

const SITE_URL = 'https://adelie.space';
const MARK_VIEWBOX = '0 0 465.206 520.464';

/**
 * Page frame. Header and footer are identical to the public site (apps/site):
 * logo + name left, theme toggle right; footer links left, language dropdown right.
 * Styles: .shell-* in globals.css (mirrors apps/site/style.css).
 */
export function AppShell({
  children,
  headerRight,
  centered = false,
}: {
  children: ReactNode;
  headerRight?: ReactNode;
  centered?: boolean;
}) {
  const t = useTranslations('Common');
  const locale = useLocale();
  const privacyUrl = locale === 'en' ? `${SITE_URL}/privacy` : `${SITE_URL}/${locale}/privacy`;

  return (
    <div className="shell-wrap flex min-h-full flex-1 flex-col">
      <header className="shell-header">
        <Link href="/" className="shell-brand">
          <svg viewBox={MARK_VIEWBOX} aria-hidden="true">
            <use href="/logo.svg#mark" />
          </svg>
          Adelie
        </Link>
        <div className="shell-actions">
          {headerRight}
          <ThemeToggle />
        </div>
      </header>

      <main className={centered ? 'flex flex-1 items-center justify-center py-10' : 'flex-1 py-6'}>
        {children}
      </main>

      <footer className="shell-footer">
        <div className="footer-links">
          <span>© 2026 Adelie</span>
          <a href={privacyUrl}>{t('privacyPolicy')}</a>
          <a href="mailto:hello@adelie.space">hello@adelie.space</a>
        </div>
        <LocaleSwitcher />
      </footer>
    </div>
  );
}
