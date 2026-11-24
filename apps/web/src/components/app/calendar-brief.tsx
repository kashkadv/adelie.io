'use client';

import { Check, ChevronDown, Plus, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Checkbox } from '../ui/checkbox';
import { InfoTip } from '../ui/info-tip';
import { ChannelIcon } from './link-ui';
import { DirectionHits, type HitSettings, type HitSource } from './calendar-hits';
import { ProjectFacts } from './project-facts';
import { LINK_CHANNELS, type LinkChannel } from './links-data';

/** One direction of the project (ADR-0030): its own goal, audience, language and channels. */
export interface Direction {
  id: string;
  name: string;
  goal: string;
  audience: string;
  language: string;
  channels: LinkChannel[];
  /** Where the direction's hits come from (ADR-0037); null = none. */
  hits: HitSettings | null;
}
export interface Brief {
  about: string;
  voice: string;
  difference: string;
  avoid: string;
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
  hits: null,
});
const emptyBrief = (): Brief => ({
  about: '',
  voice: '',
  difference: '',
  avoid: '',
  assets: '',
  directions: [newDirection()],
});

/**
 * The project's brief (ADR-0029, ADR-0030): what it is and what exists, and its directions — each
 * with a goal, audience, language and channels; the week's focus picks among them.
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
  const [sources, setSources] = useState<HitSource[]>([]);
  const [version, setVersion] = useState(0);
  const [edited, setEdited] = useState(false);
  /** Directions that are open: all start folded, a new or still unnamed one starts open. */
  const [open, setOpen] = useState<Set<string>>(new Set());
  /** The general information starts folded, open only while still empty. */
  const [commonOpen, setCommonOpen] = useState(false);
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'failed'>('idle');

  useEffect(() => {
    let cancelled = false;
    api<{ brief: Brief | null; sources?: HitSource[] }>(`${base}/brief`).then(
      (r) => {
        if (cancelled) return;
        setSources(r.sources ?? []);
        setCommonOpen(!r.brief?.about.trim());
        setOpen(
          new Set(
            (r.brief?.directions ?? [newDirection()])
              .filter((d) => !d.name.trim())
              .map((d) => d.id),
          ),
        );
        setBrief(
          r.brief
            ? {
                ...r.brief,
                directions: r.brief.directions.length ? r.brief.directions : [newDirection()],
              }
            : emptyBrief(),
        );
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
    setEdited(true);
    setState('idle');
  };
  const setDirection = (id: string, patch: Partial<Direction>) =>
    set({ directions: brief.directions.map((d) => (d.id === id ? { ...d, ...patch } : d)) });

  const toggle = (id: string) =>
    setOpen((o) => {
      const next = new Set(o);
      if (!next.delete(id)) next.add(id);
      return next;
    });

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
      setVersion((v) => v + 1);
      setEdited(false);
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
    key: 'about' | 'voice' | 'difference' | 'avoid' | 'assets' | 'goal' | 'audience',
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
    <div className="animate-rise grid gap-4">
      <ProjectFacts base={base} />
      <div className="grid gap-4">
        <section className="card grid gap-4 rounded-[24px] p-5">
          <button
            type="button"
            onClick={() => setCommonOpen(!commonOpen)}
            aria-expanded={commonOpen}
            title={commonOpen ? t('directionClose') : t('directionOpen')}
            className="flex min-w-0 items-center gap-2 rounded-xl text-left"
          >
            <ChevronDown
              size={15}
              className={`shrink-0 transition-transform ${commonOpen ? '' : '-rotate-90'}`}
              aria-hidden="true"
            />
            <span className="text-sm font-semibold">{t('common')}</span>
            {!commonOpen && brief.about && (
              <span className="ml-1 truncate text-xs text-muted">{brief.about}</span>
            )}
          </button>
          {commonOpen && (
            <>
              {area('about', brief.about, (about) => set({ about }), 2, 2000)}
              {area('voice', brief.voice, (voice) => set({ voice }), 3, 1500)}
              {area('difference', brief.difference, (difference) => set({ difference }), 3, 1500)}
              {area('avoid', brief.avoid, (avoid) => set({ avoid }), 2, 1500)}
              {area('assets', brief.assets, (assets) => set({ assets }), 2, 2000)}
            </>
          )}
        </section>

        <div className="mt-6 flex items-center justify-between gap-3 px-1">
          <h2 className="flex items-center gap-1.5 text-base font-semibold">
            {t('directions')}
            <span className="font-normal text-muted">({brief.directions.length})</span>
            <InfoTip text={t('directionsHint')} />
          </h2>
          {canManage && (
            <button
              type="button"
              onClick={() => {
                const d = newDirection();
                setOpen((o) => new Set(o).add(d.id));
                set({ directions: [...brief.directions, d] });
              }}
              disabled={brief.directions.length >= MAX_DIRECTIONS}
              className="inline-flex h-10 items-center gap-1.5 rounded-2xl border border-line px-3.5 text-sm hover:bg-hover"
            >
              <Plus size={15} aria-hidden="true" />
              {t('addDirection')}
            </button>
          )}
        </div>

        {brief.directions.map((d, i) => {
          const isOpen = open.has(d.id);
          return (
            <section key={d.id} className="card grid gap-4 rounded-[24px] p-5">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => toggle(d.id)}
                  aria-expanded={isOpen}
                  title={isOpen ? t('directionClose') : t('directionOpen')}
                  className="flex min-w-0 flex-1 items-center gap-2 rounded-xl text-left"
                >
                  <ChevronDown
                    size={15}
                    className={`shrink-0 transition-transform ${isOpen ? '' : '-rotate-90'}`}
                    aria-hidden="true"
                  />
                  <span className="truncate text-sm font-semibold">
                    {d.name.trim() || t('direction', { n: i + 1 })}
                  </span>
                  {!isOpen && (
                    <span className="ml-1 flex min-w-0 items-center gap-2 text-xs text-muted">
                      {d.channels.map((c) => (
                        <ChannelIcon key={c} channel={c} />
                      ))}
                      {d.language && <span className="truncate">{d.language}</span>}
                      {d.hits && <span>{t('hitsSummary', { n: d.hits.accountIds.length })}</span>}
                    </span>
                  )}
                </button>
                {canManage && brief.directions.length > 1 && (
                  <button
                    type="button"
                    onClick={() =>
                      set({ directions: brief.directions.filter((x) => x.id !== d.id) })
                    }
                    className="inline-flex items-center gap-1.5 rounded-xl px-2.5 py-1 text-xs text-muted hover:bg-hover hover:text-rose-600"
                  >
                    <Trash2 size={13} aria-hidden="true" />
                    {t('removeDirection')}
                  </button>
                )}
              </div>
              {isOpen && (
                <>
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
                  {area(
                    'audience',
                    d.audience,
                    (audience) => setDirection(d.id, { audience }),
                    3,
                    1500,
                  )}
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
                                channels: on
                                  ? [...d.channels, c]
                                  : d.channels.filter((x) => x !== c),
                              })
                            }
                          />
                          <ChannelIcon channel={c} />
                          {tl(`channels.${c}`)}
                        </label>
                      ))}
                    </div>
                  </div>
                  <DirectionHits
                    base={base}
                    directionId={d.id}
                    settings={d.hits}
                    sources={sources}
                    canManage={canManage}
                    version={version}
                    edited={edited}
                    onChange={(hits) => setDirection(d.id, { hits })}
                  />
                </>
              )}
            </section>
          );
        })}

        {state === 'failed' && (
          <p role="alert" className="px-3.5 text-xs text-rose-600 dark:text-rose-400">
            {t('failed')}
          </p>
        )}
        {canManage && (
          <div className="flex flex-wrap items-center justify-end gap-3">
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
    </div>
  );
}
