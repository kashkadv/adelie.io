'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Checkbox } from '../ui/checkbox';
import { InfoTip } from '../ui/info-tip';
import { Select } from '../ui/select';

/** Where a direction's hits come from (ADR-0037). */
export interface HitSettings {
  accountIds: string[];
  days: number;
}
export interface HitSource {
  id: string;
  platform: string;
  name: string;
}
interface Hit {
  key: string;
  title: string;
  url: string | null;
  signals: { purchases: number; checkouts: number; views: number };
  coverage: { pins90: number };
  status: 'ready' | 'cooling';
  reason: 'recent_pin' | 'in_calendar' | null;
  daysSincePin: number | null;
}

const PERIODS = [7, 14, 30, 60, 90];
export const DEFAULT_HITS: HitSettings = { accountIds: [], days: 30 };

/**
 * A direction's hits (ADR-0037): the sources they are counted from and the period, and — once
 * saved — the list the AI works from: products weighed by purchases, started checkouts and views,
 * with what has been published for each and whether it rests.
 */
export function DirectionHits({
  base,
  directionId,
  settings,
  sources,
  canManage,
  version,
  edited,
  onChange,
}: {
  base: string;
  directionId: string;
  settings: HitSettings | null;
  sources: HitSource[];
  canManage: boolean;
  /** Bumped after the brief is saved: the list is read again. */
  version: number;
  /** The settings were changed since the brief was saved: the list below is of the saved ones. */
  edited: boolean;
  onChange: (settings: HitSettings | null) => void;
}) {
  const t = useTranslations('Calendar.brief');
  const format = (n: number) => n.toLocaleString();
  const [hits, setHits] = useState<Hit[] | null>(null);
  const current = settings ?? DEFAULT_HITS;

  useEffect(() => {
    let cancelled = false;
    api<{ hits: Hit[] }>(`${base}/hits?direction=${encodeURIComponent(directionId)}`).then(
      (r) => !cancelled && setHits(r.hits),
      () => !cancelled && setHits([]),
    );
    return () => {
      cancelled = true;
    };
  }, [base, directionId, version]);

  const toggle = (id: string, on: boolean) => {
    const accountIds = on
      ? [...current.accountIds, id]
      : current.accountIds.filter((x) => x !== id);
    onChange(accountIds.length ? { ...current, accountIds } : null);
  };

  return (
    <div>
      <span className="mb-1.5 flex items-center gap-1.5 px-3.5 text-sm text-muted">
        {t('hits')}
        <InfoTip text={t('hitsHint')} />
      </span>
      {sources.length === 0 ? (
        <p className="px-3.5 text-sm text-muted">{t('hitsNoSources')}</p>
      ) : (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-3.5">
          {sources.map((s) => (
            <label key={s.id} className="inline-flex items-center gap-2 text-sm">
              <Checkbox
                checked={current.accountIds.includes(s.id)}
                label={s.name}
                onChange={(on) => canManage && toggle(s.id, on)}
              />
              {s.name}
            </label>
          ))}
          {settings && (
            <span className="ml-auto flex items-center gap-2 text-sm text-muted">
              {t('hitsPeriod')}
              <span className="w-32">
                <Select
                  ariaLabel={t('hitsPeriod')}
                  value={String(current.days)}
                  onChange={(v) => canManage && onChange({ ...current, days: Number(v) })}
                  options={PERIODS.map((n) => ({
                    value: String(n),
                    label: t('hitsDays', { n }),
                  }))}
                />
              </span>
            </span>
          )}
        </div>
      )}

      {settings && (
        <div className="mt-3 rounded-2xl border border-line p-3">
          <p className="mb-2 flex items-center gap-1.5 px-1 text-sm font-medium">
            {t('hitsTitle', { days: current.days })}
            {edited && <InfoTip tone="warning" text={t('hitsSaveFirst')} />}
          </p>
          {hits === null ? (
            <p className="px-1 py-2 text-sm text-muted">…</p>
          ) : hits.length === 0 ? (
            <p className="px-1 py-2 text-sm text-muted">{t('hitsEmpty')}</p>
          ) : (
            <div className="scroll-thin overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted">
                    <th className="pr-3 pb-2 font-normal">{t('hitsProduct')}</th>
                    <th className="px-3 pb-2 text-right font-normal">{t('hitsPurchases')}</th>
                    <th className="px-3 pb-2 text-right font-normal">{t('hitsCheckouts')}</th>
                    <th className="px-3 pb-2 text-right font-normal">{t('hitsViews')}</th>
                    <th className="px-3 pb-2 font-normal">{t('hitsPosts')}</th>
                    <th className="pb-2 pl-3 font-normal"> </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {hits.slice(0, 15).map((h) => (
                    <tr key={h.key} className={h.status === 'cooling' ? 'text-muted' : undefined}>
                      <td className="max-w-[280px] truncate py-2 pr-3">{h.title}</td>
                      <td className="tabular px-3 py-2 text-right">
                        {format(h.signals.purchases)}
                      </td>
                      <td className="tabular px-3 py-2 text-right">
                        {format(h.signals.checkouts)}
                      </td>
                      <td className="tabular px-3 py-2 text-right">{format(h.signals.views)}</td>
                      <td className="px-3 py-2 text-xs whitespace-nowrap">
                        {h.coverage.pins90 > 0 && h.daysSincePin !== null
                          ? t('hitsPostsLast', { n: h.coverage.pins90, days: h.daysSincePin })
                          : t('hitsPostsNone')}
                      </td>
                      <td className="py-2 pl-3 text-xs whitespace-nowrap">
                        <span
                          className={`rounded-full px-2 py-0.5 ${
                            h.status === 'ready' ? 'bg-accent text-accent-foreground' : 'bg-hover'
                          }`}
                        >
                          {h.reason === 'recent_pin'
                            ? t('hitsRecent')
                            : h.reason === 'in_calendar'
                              ? t('hitsPlanned')
                              : t('hitsReady')}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
