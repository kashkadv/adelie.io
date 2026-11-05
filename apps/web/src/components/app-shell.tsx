import Link from 'next/link';
import type { ReactNode } from 'react';
import { LocaleSwitcher } from './locale-switcher';
import { Logo } from './logo';

/** Page frame: logo in the header, language switcher in the footer. */
export function AppShell({
  children,
  headerRight,
  centered = false,
}: {
  children: ReactNode;
  headerRight?: ReactNode;
  centered?: boolean;
}) {
  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="mx-auto flex w-full max-w-5xl items-center justify-between gap-4 px-6 py-5">
        <Link href="/" className="text-lg">
          <Logo />
        </Link>
        {headerRight && <div className="flex items-center gap-4 text-sm">{headerRight}</div>}
      </header>

      <main
        className={
          centered
            ? 'flex flex-1 items-center justify-center px-6 py-10'
            : 'mx-auto w-full max-w-5xl flex-1 px-6 py-6'
        }
      >
        {children}
      </main>

      <footer className="mx-auto flex w-full max-w-5xl items-center justify-between gap-4 border-t border-black/10 px-6 py-4 text-sm opacity-80 dark:border-white/10">
        <span>© Adelie</span>
        <LocaleSwitcher />
      </footer>
    </div>
  );
}
