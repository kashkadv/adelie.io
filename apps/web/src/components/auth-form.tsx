'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { authClient } from '@/lib/auth-client';
import { AuthFrame } from './auth-frame';
import { PasswordInput } from './password-input';

type Mode = 'login' | 'register';

const input = 'field';

export function AuthForm({ mode }: { mode: Mode }) {
  const t = useTranslations('Auth');
  const tCommon = useTranslations('Common');
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
    // Full navigation, not router.push: the auth client may still hold the cached "no session"
    // answer, and the app frame would bounce back to /login (the "works only on the second try" bug).
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- intentional reload
    window.location.assign('/');
  }

  return (
    <AuthFrame>
      {/* The form is a size container: the title scales with its width to stay on one line. */}
      <form onSubmit={onSubmit} className="@container w-full space-y-4">
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
        <PasswordInput
          className={input}
          name="password"
          placeholder={t('password')}
          required
          minLength={8}
          autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
        />
        {error && (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {error}
          </p>
        )}
        <button type="submit" disabled={pending} className="btn-primary">
          {pending ? '…' : mode === 'register' ? t('createAccount') : t('signIn')}
        </button>
        <p className="text-center text-sm text-muted">
          {mode === 'register' ? (
            <>
              {t('haveAccount')}{' '}
              <Link href="/login" className="text-foreground underline underline-offset-4">
                {t('signIn')}
              </Link>
            </>
          ) : (
            <>
              {t('noAccount')}{' '}
              <Link href="/register" className="text-foreground underline underline-offset-4">
                {t('createOne')}
              </Link>
            </>
          )}
        </p>
      </form>
    </AuthFrame>
  );
}
