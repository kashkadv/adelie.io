'use client';

import { Moon, Sun } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { currentTheme, setTheme } from '@/lib/theme';

/** Light/dark switch. Icons are swapped by CSS (.theme-toggle) — no hydration mismatch. */
export function ThemeToggle({ className = 'icon-btn' }: { className?: string }) {
  const t = useTranslations('Common');

  return (
    <button
      type="button"
      className={`theme-toggle ${className}`}
      aria-label={t('toggleTheme')}
      title={t('toggleTheme')}
      onClick={() => setTheme(currentTheme() === 'dark' ? 'light' : 'dark')}
    >
      {/* Shows the theme you would switch to: moon on light, sun on dark. */}
      <Moon className="to-dark" size={18} strokeWidth={1.75} aria-hidden="true" />
      <Sun className="to-light" size={18} strokeWidth={1.75} aria-hidden="true" />
    </button>
  );
}
