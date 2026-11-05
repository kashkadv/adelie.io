'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { localeLabels, locales, type Locale } from '@/i18n/config';
import { setLocale } from '@/i18n/actions';

/**
 * Compact language button: shows the current language code and switches to the next one.
 * With many languages this should become a menu.
 */
export function LocaleSwitcher({ className = 'icon-btn' }: { className?: string }) {
  const t = useTranslations('Common');
  const locale = useLocale() as Locale;
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const next = locales[(locales.indexOf(locale) + 1) % locales.length]!;

  return (
    <button
      type="button"
      className={`${className} text-xs font-semibold uppercase tracking-wide disabled:opacity-50`}
      aria-label={`${t('language')}: ${localeLabels[locale]} → ${localeLabels[next]}`}
      title={`${t('language')}: ${localeLabels[next]}`}
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          await setLocale(next);
          router.refresh();
        })
      }
    >
      {locale}
    </button>
  );
}
