import type { Metadata } from 'next';
import localFont from 'next/font/local';
import { Suspense } from 'react';
import { LocaleProvider } from '@/components/locale-provider';
import { themeInitScript } from '@/lib/theme';
import './globals.css';

// Brand fonts (self-hosted, SIL OFL; built by scripts/brand-fonts.py) — same as the public site.
const onest = localFont({
  src: '../fonts/Onest.woff2',
  weight: '100 900',
  variable: '--font-onest',
  display: 'swap',
});

const tektur = localFont({
  src: '../fonts/Tektur.woff2',
  weight: '400 900',
  variable: '--font-tektur',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Adelie — Marketing Intelligence',
  description: 'See the signals. Understand the market. Make better moves.',
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    // lang is updated on the client by <HtmlLang> once the locale is resolved.
    // suppressHydrationWarning: browser extensions inject attributes into <html>/<body>
    // before hydration (e.g. location="..."). Applies to these elements' attributes only.
    <html
      lang="en"
      className={`${onest.variable} ${tektur.variable} h-full`}
      suppressHydrationWarning
    >
      <head>
        {/* Sets data-theme before first paint (no flash of the wrong theme). */}
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="min-h-full flex flex-col" suppressHydrationWarning>
        <Suspense>
          <LocaleProvider>{children}</LocaleProvider>
        </Suspense>
      </body>
    </html>
  );
}
