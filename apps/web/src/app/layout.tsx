import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import { Suspense } from 'react';
import { LocaleProvider } from '@/components/locale-provider';
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
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        <Suspense>
          <LocaleProvider>{children}</LocaleProvider>
        </Suspense>
      </body>
    </html>
  );
}
