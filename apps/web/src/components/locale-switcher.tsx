'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { localeLabels, locales } from '@/i18n/config';
import { setLocale } from '@/i18n/actions';

export function LocaleSwitcher() {
  const t = useTranslations('Common');
  const locale = useLocale();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <div className="relative inline-flex items-center">
      {/* Native arrow is hidden (appearance-none) and replaced by our chevron with proper spacing. */}
      <select
        aria-label={t('language')}
        value={locale}
        disabled={pending}
        onChange={(e) => {
          const next = e.target.value;
          startTransition(async () => {
            await setLocale(next);
            router.refresh();
          });
        }}
        className="appearance-none cursor-pointer rounded-md border border-black/15 dark:border-white/20 bg-transparent py-1.5 pl-3 pr-8 text-sm disabled:opacity-50"
      >
        {locales.map((l) => (
          <option key={l} value={l}>
            {localeLabels[l]}
          </option>
        ))}
      </select>
      <svg
        viewBox="0 0 16 16"
        aria-hidden="true"
        className="pointer-events-none absolute right-2.5 h-3.5 w-3.5 opacity-60"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M4 6l4 4 4-4" />
      </svg>
    </div>
  );
}
