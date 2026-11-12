'use client';

import { Check } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { InfoTip } from '../ui/info-tip';
import {
  asDate,
  isPublished,
  postNumbers,
  type CalendarItem,
  type Format,
  type ReviewGroup,
  type WeekReview,
} from './calendar-data';
import { ChannelIcon } from './link-ui';
import type { LinkChannel } from './links-data';

/**
 * The week in review (ADR-0028): plan against fact, what each publication brought since the week
 * began (its link's clicks, visits and goals; its post's numbers), totals by channel and format,
 * and the owner's conclusion — saving it marks the week's published items "measured".
 */
export function CalendarReview({
  base,
  week,
  canManage,
  onOpen,
  version,
}: {
  base: string;
  week: string;
  canManage: boolean;
  onOpen: (item: CalendarItem) => void;
  /** Bumped by the page when an item changed. */
  version: number;
}) {
  const t = useTranslations('Calendar');
  const tl = useTranslations('Links');
  const format = useFormatter();
  const [data, setData] = useState<WeekReview | null>(null);
  const [notes, setNotes] = useState('');
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'failed'>('idle');
  const [reloaded, setReloaded] = useState(0);

  useEffect(() => {
    let cancelled = false;
    api<WeekReview>(`${base}/review?week=${week}`).then(
      (r) => {
        if (cancelled) return;
        setData(r);
        setNotes(r.review?.notes ?? '');
        setState('idle');
      },
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [base, week, version, reloaded]);

  async function save() {
    setState('saving');
    try {
      await api(`${base}/review`, { method: 'PUT', json: { week, notes } });
      setState('saved');
      setReloaded((v) => v + 1);
    } catch {
      setState('failed');
    }
  }

  if (!data) return <p className="py-10 text-center text-sm text-muted">…</p>;
  const num = (n: number) => format.number(n);
  const dash = <span className="text-muted">—</span>;
  const weekBudget = data.dailyMinutes !== null ? data.dailyMinutes * 7 : null;

  const tile = (label: string, value: string, hint?: string) => (
    <div className="card rounded-[22px] p-4">
      <p className="flex items-center gap-1.5 text-xs text-muted">
        {label}
        {hint && <InfoTip text={hint} />}
      </p>
      <p className="tabular mt-1 text-2xl font-semibold">{value}</p>
    </div>
  );

  const groups = (title: string, rows: ReviewGroup[], label: (key: string) => string) =>
    rows.length > 0 && (
      <section className="card rounded-[24px] p-5">
        <h3 className="mb-3 text-sm font-semibold">{title}</h3>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-muted">
              <th className="pr-3 pb-2 font-normal" />
              <th className="pb-2 pl-3 text-right font-normal">{t('colPublished')}</th>
              <th className="pb-2 pl-3 text-right font-normal">{tl('colClicks')}</th>
              <th className="pb-2 pl-3 text-right font-normal">{tl('colVisits')}</th>
              <th className="pb-2 pl-3 text-right font-normal">{tl('colGoals')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((g) => (
              <tr key={g.key}>
                <td className="py-2 pr-3">{label(g.key)}</td>
                <td className="tabular py-2 pl-3 text-right">
                  {num(g.published)} / {num(g.planned)}
                </td>
                <td className="tabular py-2 pl-3 text-right">{num(g.clicks)}</td>
                <td className="tabular py-2 pl-3 text-right">{num(g.visits)}</td>
                <td className="tabular py-2 pl-3 text-right">{num(g.goals)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    );

  return (
    <div className="animate-rise grid gap-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {tile(t('planned'), num(data.plan.items))}
        {tile(t('published'), num(data.fact.items))}
        {tile(
          t('minutesPlanned'),
          weekBudget !== null
            ? t('minutesOf', { n: data.plan.minutes, budget: weekBudget })
            : t('minutesShort', { n: data.plan.minutes }),
          t('minutesPlannedHint'),
        )}
        {tile(t('minutesPublished'), t('minutesShort', { n: data.fact.minutes }))}
      </div>

      <section className="card rounded-[24px] p-5">
        <h3 className="mb-3 flex items-center gap-1.5 text-sm font-semibold">
          {t('publications')}
          <InfoTip text={t('publicationsHint')} />
        </h3>
        {data.items.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted">{t('emptyWeek')}</p>
        ) : (
          <div className="scroll-thin overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="text-left text-xs text-muted">
                  <th className="pr-3 pb-2 font-normal">{t('colDay')}</th>
                  <th className="px-3 pb-2 font-normal">{t('colWhat')}</th>
                  <th className="px-3 pb-2 font-normal">{t('status')}</th>
                  <th className="pb-2 pl-3 text-right font-normal">{tl('colClicks')}</th>
                  <th className="pb-2 pl-3 text-right font-normal">{tl('colVisits')}</th>
                  <th className="pb-2 pl-3 text-right font-normal">{tl('colGoals')}</th>
                  <th className="pb-2 pl-3 font-normal">{t('colPost')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {data.items.map((i) => (
                  <tr key={i.id}>
                    <td className="py-2 pr-3 whitespace-nowrap text-muted">
                      {format.dateTime(asDate(i.date!), {
                        weekday: 'short',
                        day: 'numeric',
                        timeZone: 'UTC',
                      })}
                    </td>
                    <td className="max-w-[280px] px-3 py-2">
                      <button
                        type="button"
                        onClick={() => onOpen(i)}
                        className="flex max-w-full items-center gap-1.5 text-left hover:underline"
                      >
                        <ChannelIcon channel={i.channel} />
                        <span className="truncate">{i.title}</span>
                      </button>
                      <span className="block truncate pl-6 text-xs text-muted">
                        {t(`formats.${i.format}`)}
                        {i.minutes ? ` · ${t('minutesShort', { n: i.minutes })}` : ''}
                      </span>
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <span className="inline-flex items-center gap-1">
                        {isPublished(i.status) && <Check size={13} aria-hidden="true" />}
                        {t(`statuses.${i.status}`)}
                      </span>
                    </td>
                    <td className="tabular py-2 pl-3 text-right">
                      {i.result && i.link?.shortUrl ? num(i.result.clicks) : dash}
                    </td>
                    <td className="tabular py-2 pl-3 text-right">
                      {i.result?.site ? num(i.result.site.visits) : dash}
                    </td>
                    <td className="tabular py-2 pl-3 text-right">
                      {i.result?.site ? num(i.result.site.conversions) : dash}
                    </td>
                    <td className="max-w-[220px] truncate py-2 pl-3 text-xs text-muted">
                      {i.post
                        ? postNumbers(i.post.latest)
                            .map(([k, v]) => `${t(`postStats.${k}`)} ${num(v)}`)
                            .join(' · ') || '—'
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        {groups(t('byChannel'), data.byChannel, (k) => tl(`channels.${k as LinkChannel}`))}
        {groups(t('byFormat'), data.byFormat, (k) => t(`formats.${k as Format}`))}
      </div>

      <section className="card rounded-[24px] p-5">
        <h3 className="mb-3 flex items-center gap-1.5 text-sm font-semibold">
          {t('conclusion')}
          <InfoTip text={t('conclusionHint')} />
        </h3>
        <textarea
          rows={5}
          maxLength={10000}
          disabled={!canManage}
          className="field scroll-thin min-h-28 resize-y py-2.5"
          placeholder={t('conclusionPlaceholder')}
          value={notes}
          onChange={(e) => {
            setNotes(e.target.value);
            if (state !== 'saving') setState('idle');
          }}
        />
        {state === 'failed' && (
          <p role="alert" className="mt-1 px-3.5 text-xs text-rose-600 dark:text-rose-400">
            {t('errors.failed')}
          </p>
        )}
        {canManage && (
          <div className="mt-3 flex items-center justify-end gap-3">
            {state === 'saved' && (
              <span className="inline-flex items-center gap-1 text-sm text-muted">
                <Check size={14} aria-hidden="true" />
                {t('reviewSaved')}
              </span>
            )}
            <button
              type="button"
              onClick={() => void save()}
              disabled={state === 'saving'}
              className="btn-primary w-auto px-5"
            >
              {t('saveReview')}
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
