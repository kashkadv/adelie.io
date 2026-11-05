/**
 * Supported UI languages. To add a language:
 *   1. add its code here and a label in `localeLabels`;
 *   2. create `messages/<code>.json` with the same keys as `messages/en.json`
 *      (`pnpm --filter @adelie/web lint` checks that keys match).
 */
export const locales = ['en', 'uk'] as const;
export type Locale = (typeof locales)[number];

export const defaultLocale: Locale = 'en';

/** Language names in their own language, for the switcher. */
export const localeLabels: Record<Locale, string> = {
  en: 'English',
  uk: 'Українська',
};

export const LOCALE_COOKIE = 'locale';

export function isLocale(value: string | undefined | null): value is Locale {
  return !!value && (locales as readonly string[]).includes(value);
}

/** Picks the best supported locale from an Accept-Language header. */
export function localeFromAcceptLanguage(header: string | null): Locale | undefined {
  if (!header) return undefined;
  const tags = header
    .split(',')
    .map((part) => {
      const [tag = '', q] = part.trim().split(';q=');
      return { tag: tag.toLowerCase(), q: q ? Number(q) : 1 };
    })
    .sort((a, b) => b.q - a.q);
  for (const { tag } of tags) {
    const base = tag.split('-')[0];
    if (isLocale(base)) return base;
  }
  return undefined;
}
