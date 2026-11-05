import { NextIntlClientProvider } from 'next-intl';
import { getLocale } from 'next-intl/server';
import type { ReactNode } from 'react';
import { HtmlLang } from './html-lang';

/** Reads the request locale (dynamic: cookies/headers), so it must render inside <Suspense>. */
export async function LocaleProvider({ children }: { children: ReactNode }) {
  const locale = await getLocale();
  return (
    <NextIntlClientProvider>
      <HtmlLang locale={locale} />
      {children}
    </NextIntlClientProvider>
  );
}
