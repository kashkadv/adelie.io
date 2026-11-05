'use client';

import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { BrandMark } from './brand';
import { LocaleSwitcher } from './locale-switcher';
import { ThemeToggle } from './theme-toggle';

const SITE_URL = 'https://adelie.space';

/** Full-screen frame for sign-in / sign-up: brand on top, a glass card in the middle. */
export function AuthFrame({ children }: { children: ReactNode }) {
  const t = useTranslations('Common');
  const locale = useLocale();
  const privacyUrl = locale === 'en' ? `${SITE_URL}/privacy` : `${SITE_URL}/${locale}/privacy`;

  return (
    <div className="flex min-h-dvh flex-col px-4 py-4 md:px-8">
      <header className="flex items-center justify-between">
        <Link href="/" className="flex items-center gap-3">
          <BrandMark className="h-8 w-7" />
          <span className="wordmark text-2xl">Adelie</span>
        </Link>
        <div className="flex items-center gap-1">
          <ThemeToggle />
          <LocaleSwitcher />
        </div>
      </header>

      <main className="flex flex-1 items-center justify-center py-10">
        <div className="glass animate-rise w-full max-w-md rounded-[32px] p-6 md:p-8">
          {children}
        </div>
      </main>

      <footer className="flex flex-wrap justify-center gap-x-5 gap-y-1 text-xs text-muted">
        <span>© 2026 Adelie</span>
        <a href={privacyUrl} className="hover:text-foreground">
          {t('privacyPolicy')}
        </a>
        <a href="mailto:hello@adelie.space" className="hover:text-foreground">
          hello@adelie.space
        </a>
      </footer>
    </div>
  );
}
