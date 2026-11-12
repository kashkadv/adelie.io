'use client';

import { Check } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Checkbox } from '../ui/checkbox';
import { InfoTip } from '../ui/info-tip';
import { ChannelIcon } from './link-ui';
import { LINK_CHANNELS, type LinkChannel } from './links-data';

export interface Brief {
  about: string;
  audience: string;
  language: string;
  channels: LinkChannel[];
  assets: string;
  goal: string;
}
export type AiState =
  { enabled: false } | { enabled: true; model: string; spentUsd: number; limitUsd: number };

const EMPTY: Brief = { about: '', audience: '', language: '', channels: [], assets: '', goal: '' };

/**
 * The project's brief (ADR-0029): what it is, for whom, in which language and channels, what
 * exists, the goal — what the AI's ideas start from. Plus this month's AI spending.
 */
export function CalendarBrief({
  base,
  canManage,
  onSaved,
}: {
  base: string;
  canManage: boolean;
  onSaved: () => void;
}) {
  const t = useTranslations('Calendar.brief');
  const tl = useTranslations('Links');
  const [brief, setBrief] = useState<Brief | null>(null);
  const [ai, setAi] = useState<AiState | null>(null);
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'failed'>('idle');

  useEffect(() => {
    let cancelled = false;
    api<{ brief: Brief | null; ai: AiState }>(`${base}/brief`).then(
      (r) => {
        if (cancelled) return;
        setBrief(r.brief ?? EMPTY);
        setAi(r.ai);
      },
      () => !cancelled && setBrief(EMPTY),
    );
    return () => {
      cancelled = true;
    };
  }, [base]);

  if (!brief) return <p className="py-10 text-center text-sm text-muted">…</p>;
  const set = (patch: Partial<Brief>) => {
    setBrief({ ...brief, ...patch });
    setState('idle');
  };

  async function save() {
    setState('saving');
    try {
      await api(`${base}/brief`, { method: 'PUT', json: brief });
      setState('saved');
      onSaved();
    } catch {
      setState('failed');
    }
  }

  const area = (key: 'about' | 'audience' | 'assets' | 'goal', rows: number, max: number) => (
    <label className="block">
      <span className="mb-1.5 flex items-center gap-1.5 px-3.5 text-sm text-muted">
        {t(key)}
        <InfoTip text={t(`${key}Hint`)} />
      </span>
      <textarea
        rows={rows}
        maxLength={max}
        disabled={!canManage}
        className="field scroll-thin resize-y py-2.5"
        placeholder={t(`${key}Placeholder`)}
        value={brief[key]}
        onChange={(e) => set({ [key]: e.target.value })}
      />
    </label>
  );

  return (
    <div className="animate-rise grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      <section className="card grid gap-4 rounded-[24px] p-5">
        {area('about', 3, 2000)}
        {area('audience', 2, 1000)}
        <label className="block">
          <span className="mb-1.5 flex items-center gap-1.5 px-3.5 text-sm text-muted">
            {t('language')}
            <InfoTip text={t('languageHint')} />
          </span>
          <input
            maxLength={60}
            disabled={!canManage}
            className="field"
            placeholder={t('languagePlaceholder')}
            value={brief.language}
            onChange={(e) => set({ language: e.target.value })}
          />
        </label>
        <div>
          <span className="mb-1.5 flex items-center gap-1.5 px-3.5 text-sm text-muted">
            {t('channels')}
            <InfoTip text={t('channelsHint')} />
          </span>
          <div className="flex flex-wrap gap-x-4 gap-y-2 px-3.5">
            {LINK_CHANNELS.filter((c) => c !== 'other').map((c) => (
              <label key={c} className="inline-flex items-center gap-2 text-sm">
                <Checkbox
                  checked={brief.channels.includes(c)}
                  label={tl(`channels.${c}`)}
                  onChange={(on) =>
                    canManage &&
                    set({
                      channels: on ? [...brief.channels, c] : brief.channels.filter((x) => x !== c),
                    })
                  }
                />
                <ChannelIcon channel={c} />
                {tl(`channels.${c}`)}
              </label>
            ))}
          </div>
        </div>
        {area('assets', 2, 2000)}
        {area('goal', 2, 500)}
        {state === 'failed' && (
          <p role="alert" className="px-3.5 text-xs text-rose-600 dark:text-rose-400">
            {t('failed')}
          </p>
        )}
        {canManage && (
          <div className="flex items-center justify-end gap-3">
            {state === 'saved' && (
              <span className="inline-flex items-center gap-1 text-sm text-muted">
                <Check size={14} aria-hidden="true" />
                {t('saved')}
              </span>
            )}
            <button
              type="button"
              onClick={() => void save()}
              disabled={state === 'saving' || !brief.about.trim()}
              className="btn-primary w-auto px-5"
            >
              {t('save')}
            </button>
          </div>
        )}
      </section>

      <section className="card h-fit rounded-[24px] p-5 text-sm">
        <h3 className="mb-2 flex items-center gap-1.5 font-semibold">
          {t('aiTitle')}
          <InfoTip text={t('aiHint')} />
        </h3>
        {!ai ? null : ai.enabled ? (
          <dl className="grid gap-1.5">
            <div className="flex justify-between gap-3">
              <dt className="text-muted">{t('aiSpent')}</dt>
              <dd className="tabular">
                ${ai.spentUsd.toFixed(2)} / ${ai.limitUsd.toFixed(2)}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted">{t('aiModel')}</dt>
              <dd className="truncate">{ai.model}</dd>
            </div>
          </dl>
        ) : (
          <p className="text-muted">{t('aiOff')}</p>
        )}
      </section>
    </div>
  );
}
