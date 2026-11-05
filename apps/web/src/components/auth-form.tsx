'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { authClient } from '@/lib/auth-client';

type Mode = 'login' | 'register';

const input =
  'w-full rounded-md border border-black/15 dark:border-white/20 bg-transparent px-3 py-2 outline-none focus:border-current';

export function AuthForm({ mode }: { mode: Mode }) {
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
      setError(error.message ?? 'Something went wrong');
      return;
    }
    router.push('/');
  }

  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <form onSubmit={onSubmit} className="w-full max-w-sm space-y-4">
        <h1 className="text-2xl font-semibold">
          {mode === 'register' ? 'Create account' : 'Sign in'} to Adelie
        </h1>
        {mode === 'register' && (
          <input className={input} name="name" placeholder="Name" required autoComplete="name" />
        )}
        <input
          className={input}
          name="email"
          type="email"
          placeholder="Email"
          required
          autoComplete="email"
        />
        <input
          className={input}
          name="password"
          type="password"
          placeholder="Password"
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
          {pending ? '…' : mode === 'register' ? 'Create account' : 'Sign in'}
        </button>
        <p className="text-sm opacity-70">
          {mode === 'register' ? (
            <>
              Have an account?{' '}
              <Link href="/login" className="underline">
                Sign in
              </Link>
            </>
          ) : (
            <>
              No account?{' '}
              <Link href="/register" className="underline">
                Create one
              </Link>
            </>
          )}
        </p>
      </form>
    </main>
  );
}
