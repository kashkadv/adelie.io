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
      className="rounded-md border border-black/15 dark:border-white/20 bg-transparent px-2 py-1 text-sm"
    >
      {locales.map((l) => (
        <option key={l} value={l}>
          {localeLabels[l]}
        </option>
      ))}
    </select>
  );
}
