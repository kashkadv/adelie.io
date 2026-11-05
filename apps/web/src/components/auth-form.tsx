'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { authClient } from '@/lib/auth-client';
import { AppShell } from './app-shell';

type Mode = 'login' | 'register';

const input =
  'w-full rounded-md border border-line bg-transparent px-3 py-2 outline-none focus:border-current';

export function AuthForm({ mode }: { mode: Mode }) {
  const t = useTranslations('Auth');
  const tCommon = useTranslations('Common');
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);
    const form = new FormData(event.currentTarget);
    const email = String(form.get('email'));
    const password = String(form.get('password'));

    const { error } =
      mode === 'register'
        ? await authClient.signUp.email({ email, password, name: String(form.get('name')) })
        : await authClient.signIn.email({ email, password });

    setPending(false);
    if (error) {
      // Better Auth messages are English-only for now.
      setError(error.message ?? tCommon('genericError'));
      return;
    }
    router.push('/');
  }

  return (
    <AppShell centered>
      {/* The form is a size container: the title scales with its width to stay on one line. */}
      <form onSubmit={onSubmit} className="@container w-full max-w-md space-y-4">
        <h1
          className="mb-6 font-semibold leading-tight whitespace-nowrap"
          // Longest title (uk) is ~15.5em wide in Onest 600 → 28px fits 448px; shrinks on narrow screens.
          style={{ fontSize: 'min(28px, calc(100cqi / 15.9))' }}
        >
          {mode === 'register' ? t('registerTitle') : t('signInTitle')}
        </h1>
        {mode === 'register' && (
          <input
            className={input}
            name="name"
            placeholder={t('name')}
            required
            autoComplete="name"
          />
        )}
        <input
          className={input}
          name="email"
          type="email"
          placeholder={t('email')}
          required
          autoComplete="email"
        />
        <input
          className={input}
          name="password"
          type="password"
          placeholder={t('password')}
          required
          minLength={8}
          autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
        />
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button
          type="submit"
          disabled={pending}
          className="w-full rounded-md bg-foreground px-3 py-2 text-background disabled:opacity-50"
        >
          {pending ? '…' : mode === 'register' ? t('createAccount') : t('signIn')}
        </button>
        <p className="text-sm opacity-70">
          {mode === 'register' ? (
            <>
              {t('haveAccount')}{' '}
              <Link href="/login" className="underline">
                {t('signIn')}
              </Link>
            </>
          ) : (
            <>
              {t('noAccount')}{' '}
              <Link href="/register" className="underline">
                {t('createOne')}
              </Link>
            </>
          )}
        </p>
      </form>
    </AppShell>
  );
}
