'use client';

import { Check, Plus, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Checkbox } from '../ui/checkbox';
import { InfoTip } from '../ui/info-tip';
import { ChannelIcon } from './link-ui';
import { LINK_CHANNELS, type LinkChannel } from './links-data';

/** One direction of the project (ADR-0030): its own goal, audience, language and channels. */
export interface Direction {
  id: string;
  name: string;
  goal: string;
  audience: string;
  language: string;
  channels: LinkChannel[];
}
export interface Brief {
  about: string;
  assets: string;
  directions: Direction[];
}
export type AiState =
  { enabled: false } | { enabled: true; model: string; spentUsd: number; limitUsd: number };

const MAX_DIRECTIONS = 5;
const newDirection = (): Direction => ({
  id: `d${Math.random().toString(36).slice(2, 8)}`,
  name: '',
  goal: '',
  audience: '',
  language: '',
  channels: [],
});
const emptyBrief = (): Brief => ({ about: '', assets: '', directions: [newDirection()] });

/**
 * The project's brief (ADR-0029, ADR-0030): what it is and what exists, and its directions — each
 * with a goal, audience, language and channels; the week's focus picks among them. Plus this
 * month's AI spending.
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
        setBrief(
          r.brief
            ? {
                ...r.brief,
                directions: r.brief.directions.length ? r.brief.directions : [newDirection()],
              }
            : emptyBrief(),
        );
        setAi(r.ai);
      },
      () => !cancelled && setBrief(emptyBrief()),
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
  const setDirection = (id: string, patch: Partial<Direction>) =>
    set({ directions: brief.directions.map((d) => (d.id === id ? { ...d, ...patch } : d)) });

  async function save() {
    if (!brief) return;
    setState('saving');
    try {
      const r = await api<{ brief: Brief }>(`${base}/brief`, { method: 'PUT', json: brief });
      setBrief({
        ...r.brief,
        directions: r.brief.directions.length ? r.brief.directions : [newDirection()],
      });
      setState('saved');
      onSaved();
    } catch {
      setState('failed');
    }
  }

  const label = (text: string, hint: string) => (
    <span className="mb-1.5 flex items-center gap-1.5 px-3.5 text-sm text-muted">
      {text}
      <InfoTip text={hint} />
    </span>
  );
  const area = (
    key: 'about' | 'assets' | 'goal' | 'audience',
    value: string,
    onChange: (v: string) => void,
    rows: number,
    max: number,
  ) => (
    <label className="block">
      {label(t(key), t(`${key}Hint`))}
      <textarea
        rows={rows}
        maxLength={max}
        readOnly={!canManage}
        className="field scroll-thin resize-y py-2.5"
        placeholder={t(`${key}Placeholder`)}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );

  return (
    <div className="animate-rise grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      <div className="grid gap-4">
        <section className="card grid gap-4 rounded-[24px] p-5">
          <h3 className="text-sm font-semibold">{t('common')}</h3>
          {area('about', brief.about, (about) => set({ about }), 3, 2000)}
          {area('assets', brief.assets, (assets) => set({ assets }), 2, 2000)}
        </section>

        {brief.directions.map((d, i) => (
          <section key={d.id} className="card grid gap-4 rounded-[24px] p-5">
            <div className="flex items-center gap-2">
              <h3 className="flex flex-1 items-center gap-1.5 text-sm font-semibold">
                {t('direction', { n: i + 1 })}
                {i === 0 && <InfoTip text={t('directionsHint')} />}
              </h3>
              {canManage && brief.directions.length > 1 && (
                <button
                  type="button"
                  onClick={() => set({ directions: brief.directions.filter((x) => x.id !== d.id) })}
                  className="inline-flex items-center gap-1.5 rounded-xl px-2.5 py-1 text-xs text-muted hover:bg-hover hover:text-rose-600"
                >
                  <Trash2 size={13} aria-hidden="true" />
                  {t('removeDirection')}
                </button>
              )}
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block">
                {label(t('name'), t('nameHint'))}
                <input
                  maxLength={60}
                  readOnly={!canManage}
                  className="field"
                  placeholder={t('namePlaceholder')}
                  value={d.name}
                  onChange={(e) => setDirection(d.id, { name: e.target.value })}
                />
              </label>
              <label className="block">
                {label(t('language'), t('languageHint'))}
                <input
                  maxLength={100}
                  readOnly={!canManage}
                  className="field"
                  placeholder={t('languagePlaceholder')}
                  value={d.language}
                  onChange={(e) => setDirection(d.id, { language: e.target.value })}
                />
              </label>
            </div>
            {area('goal', d.goal, (goal) => setDirection(d.id, { goal }), 2, 500)}
            {area('audience', d.audience, (audience) => setDirection(d.id, { audience }), 3, 1500)}
            <div>
              {label(t('channels'), t('channelsHint'))}
              <div className="flex flex-wrap gap-x-4 gap-y-2 px-3.5">
                {LINK_CHANNELS.filter((c) => c !== 'other').map((c) => (
                  <label key={c} className="inline-flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={d.channels.includes(c)}
                      label={tl(`channels.${c}`)}
                      onChange={(on) =>
                        canManage &&
                        setDirection(d.id, {
                          channels: on ? [...d.channels, c] : d.channels.filter((x) => x !== c),
                        })
                      }
                    />
                    <ChannelIcon channel={c} />
                    {tl(`channels.${c}`)}
                  </label>
                ))}
              </div>
            </div>
          </section>
        ))}

        {state === 'failed' && (
          <p role="alert" className="px-3.5 text-xs text-rose-600 dark:text-rose-400">
            {t('failed')}
          </p>
        )}
        {canManage && (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => set({ directions: [...brief.directions, newDirection()] })}
              disabled={brief.directions.length >= MAX_DIRECTIONS}
              className="inline-flex h-10 items-center gap-1.5 rounded-2xl border border-line px-3.5 text-sm hover:bg-hover"
            >
              <Plus size={15} aria-hidden="true" />
              {t('addDirection')}
            </button>
            <span className="flex items-center gap-3">
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
            </span>
          </div>
        )}
      </div>

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
