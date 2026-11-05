'use client';

import { useTranslations } from 'next-intl';
import { currentTheme, setTheme } from '@/lib/theme';

/** Light/dark switch (same as on the public site). Icons are swapped by CSS — no hydration mismatch. */
export function ThemeToggle() {
  const t = useTranslations('Common');

  return (
    <button
      type="button"
      className="theme-toggle"
      aria-label={t('toggleTheme')}
      title={t('toggleTheme')}
      onClick={() => setTheme(currentTheme() === 'dark' ? 'light' : 'dark')}
    >
      {/* Shows the theme you would switch to: moon on light, sun on dark. */}
      <svg
        className="to-dark"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
      </svg>
      <svg
        className="to-light"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
      </svg>
    </button>
  );
}
