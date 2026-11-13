'use client';

import { Check, Sparkles } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { ApiError } from '@/lib/api';
import type { Seeds } from './research-data';

/**
 * Better seed phrases from the AI (ADR-0033): the owner picks among the proposed ones (all picked at
 * first) and sees what to avoid and why; "Use" puts the picked phrases into the niche field.
 */
export function SeedSuggest({
  request,
  onApply,
  disabled,
}: {
  request: () => Promise<Seeds>;
  onApply: (phrases: string[]) => void;
  disabled?: boolean;
}) {
  const t = useTranslations('Research.seeds');
  const [seeds, setSeeds] = useState<Seeds | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<'limit' | 'off' | 'failed' | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const s = await request();
      setSeeds(s);
      setPicked(new Set(s.phrases.map((p) => p.phrase)));
    } catch (err) {
      const e =
        err instanceof ApiError
          ? (err.body as { errors?: Record<string, string> } | null)?.errors?.['ai']
          : undefined;
      setError(e === 'limit' || e === 'off' ? e : 'failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-2">
      <button
        type="button"
        onClick={() => void run()}
        disabled={busy || disabled}
        className="inline-flex w-fit items-center gap-1.5 rounded-xl border border-line px-3 py-1.5 text-xs hover:bg-hover"
      >
        <Sparkles size={13} className={busy ? 'animate-pulse' : ''} aria-hidden="true" />
        {busy ? t('thinking') : seeds ? t('again') : t('suggest')}
      </button>
      {error && (
        <p role="alert" className="px-1 text-xs text-rose-600 dark:text-rose-400">
          {t(`errors.${error}`)}
        </p>
      )}
      {seeds && (
        <div className="rounded-2xl bg-hover p-3 text-sm">
          <ul className="grid gap-1.5">
            {seeds.phrases.map((p) => (
              <li key={p.phrase}>
                <button
                  type="button"
                  onClick={() => {
                    const next = new Set(picked);
                    if (next.has(p.phrase)) next.delete(p.phrase);
                    else next.add(p.phrase);
                    setPicked(next);
                  }}
                  className="flex w-full items-start gap-2 text-left"
                >
                  <span
                    className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
                      picked.has(p.phrase)
                        ? 'border-accent bg-accent text-accent-foreground'
                        : 'border-[var(--field-focus)]'
                    }`}
                  >
                    {picked.has(p.phrase) && <Check size={10} strokeWidth={3} aria-hidden="true" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="font-medium">{p.phrase}</span>
                    {p.why && <span className="block text-xs text-muted">{p.why}</span>}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {seeds.avoid.length > 0 && (
            <p className="mt-2.5 text-xs text-muted">
              <span className="font-medium text-foreground">{t('avoid')}:</span>{' '}
              {seeds.avoid.map((a) => `${a.phrase}${a.why ? ` (${a.why})` : ''}`).join('; ')}
            </p>
          )}
          <div className="mt-2.5 flex items-center justify-between gap-2">
            <span className="text-xs text-muted">
              {t('cost', { cost: seeds.costUsd.toFixed(3) })}
            </span>
            <button
              type="button"
              disabled={picked.size === 0}
              onClick={() =>
                onApply(seeds.phrases.map((p) => p.phrase).filter((p) => picked.has(p)))
              }
              className="btn-primary w-auto px-4 py-1.5 text-sm"
            >
              {t('use', { count: picked.size })}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
