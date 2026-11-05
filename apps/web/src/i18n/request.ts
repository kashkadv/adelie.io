import { cookies, headers } from 'next/headers';
import { getRequestConfig } from 'next-intl/server';
import { LOCALE_COOKIE, defaultLocale, isLocale, localeFromAcceptLanguage } from './config';

// Locale resolution: cookie (explicit choice) → Accept-Language → default.
// Later: user's saved preference from the API.
export default getRequestConfig(async () => {
  const cookieLocale = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(cookieLocale)
    ? cookieLocale
    : (localeFromAcceptLanguage((await headers()).get('accept-language')) ?? defaultLocale);

  return {
    locale,
    messages: (await import(`../../messages/${locale}.json`)).default,
  };
});
