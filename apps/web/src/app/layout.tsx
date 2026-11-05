import type { Metadata } from 'next';
import localFont from 'next/font/local';
import { Suspense } from 'react';
import { LocaleProvider } from '@/components/locale-provider';
import { themeInitScript } from '@/lib/theme';
import './globals.css';

// Brand fonts (self-hosted, SIL OFL; built by scripts/brand-fonts.py) — same as the public site:
// Inter — text and UI, Onest — headings, Playwrite IT Trad 300 — the "Adelie" wordmark only.
const inter = localFont({
  src: '../fonts/Inter.woff2',
  weight: '100 900',
  variable: '--font-inter',
  display: 'swap',
});

const onest = localFont({
  src: '../fonts/Onest.woff2',
  weight: '100 900',
  variable: '--font-onest',
  display: 'swap',
});

const playwrite = localFont({
  src: '../fonts/PlaywriteITTrad.woff2',
  weight: '300',
  variable: '--font-playwrite',
  display: 'swap',
  preload: false,
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
      className={`${inter.variable} ${onest.variable} ${playwrite.variable}`}
      suppressHydrationWarning
    >
      <head>
        {/* Sets data-theme and data-sidebar before first paint (no flash). */}
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body suppressHydrationWarning>
        <div className="app-backdrop" aria-hidden="true" />
        <Suspense>
          <LocaleProvider>{children}</LocaleProvider>
        </Suspense>
      </body>
    </html>
  );
}
