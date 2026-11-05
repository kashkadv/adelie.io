import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import { Suspense } from 'react';
import { LocaleProvider } from '@/components/locale-provider';
import { themeInitScript } from '@/lib/theme';
import './globals.css';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin', 'cyrillic'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin', 'cyrillic'],
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
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
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
