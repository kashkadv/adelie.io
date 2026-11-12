'use client';

import { useFormatter, useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { InfoTip } from '../ui/info-tip';

type Group = 'channel' | 'source_medium' | 'source' | 'medium' | 'campaign' | 'content' | 'term';
const GROUPS: Group[] = [
  'channel',
  'source_medium',
  'source',
  'medium',
  'campaign',
  'content',
  'term',
];

type Row = {
  label: string;
  visits: number;
  visitors: number;
  /** Visitors at each event step of the site's funnel (after the first). */
  steps: number[];
  /** Per goal: conversions and their worth. */
  goals: { conversions: number; visitors: number; value: number | null }[];
};
type Data = {
  currency: string | null;
  steps: { event: string }[];
  goals: { id: string; name: string | null; valued: boolean }[];
  rows: Row[];
};
/** The shop's columns keep their old names (ADR-0026: nothing changes for a shop). */
const STEP_LABELS: Record<string, 'srcProductViews' | 'srcAddToCart' | 'srcCheckouts'> = {
  ProductView: 'srcProductViews',
  AddToCart: 'srcAddToCart',
  BeginCheckout: 'srcCheckouts',
};

/** Where visitors came from, in detail: any dimension of the campaign labels, with what they did. */
export function FlipperSources({
  base,
  accountId,
  days,
}: {
  base: string;
  accountId: string;
  days: string;
}) {
  const t = useTranslations('Flipper');
  const format = useFormatter();
  const [by, setBy] = useState<Group>('channel');
  const [channel, setChannel] = useState<string | null>(null);
  const [data, setData] = useState<Data | null>(null);

  useEffect(() => {
    let cancelled = false;
    const query = new URLSearchParams({ days, by });
    if (channel) query.set('channel', channel);
    void api<Data>(`${base}/${accountId}/sources?${query.toString()}`).then(
      (d) => !cancelled && setData(d),
      () => !cancelled && setData({ currency: null, steps: [], goals: [], rows: [] }),
    );
    return () => {
      cancelled = true;
    };
  }, [base, accountId, days, by, channel]);

  const eventLabel = (e: string) =>
    STEP_LABELS[e]
      ? t(STEP_LABELS[e])
      : t.has(`events.${e}` as 'events.PageView')
        ? t(`events.${e}` as 'events.PageView')
        : e;
  const goalLabel = (g: Data['goals'][number]) =>
    g.name ??
    (g.id === 'purchase'
      ? t('srcPurchases')
      : t.has(`goalPresets.${g.id}` as 'goalPresets.purchase')
        ? t(`goalPresets.${g.id}` as 'goalPresets.purchase')
        : g.id);
  // The site's columns: visits, its funnel steps, then each goal (and its worth when valued).
  const columns: { key: string; label: string; value: (r: Row) => string }[] = data
    ? [
        { key: 'visits', label: t('srcVisits'), value: (r) => format.number(r.visits) },
        ...data.steps.map((st, i) => ({
          key: `s${i}`,
          label: eventLabel(st.event),
          value: (r: Row) => format.number(r.steps[i] ?? 0),
        })),
        ...data.goals.flatMap((g, i) => [
          {
            key: `g${i}`,
            label: goalLabel(g),
            value: (r: Row) => format.number(r.goals[i]?.conversions ?? 0),
          },
          ...(g.valued
            ? [
                {
                  key: `g${i}v`,
                  label:
                    g.id === 'purchase' ? t('srcRevenue') : t('srcValue', { goal: goalLabel(g) }),
                  value: (r: Row) => money(r.goals[i]?.value ?? null),
                },
              ]
            : []),
        ]),
      ]
    : [];
  const money = (v: number | null) =>
    v === null || v === 0
      ? '—'
      : data?.currency
        ? format.number(v, { style: 'currency', currency: data.currency, maximumFractionDigits: 0 })
        : format.number(v);

  return (
    <section className="card animate-rise mb-6 rounded-[24px] p-5">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold">
          {t('srcTitle')}
          <InfoTip text={t('srcHint')} />
        </h2>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
        <span className="text-muted">{t('srcGroupBy')}</span>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label={t('srcGroupBy')}>
          {GROUPS.map((g) => (
            <button
              key={g}
              type="button"
              aria-pressed={by === g}
              onClick={() => {
                setBy(g);
                setData(null);
              }}
              className={`rounded-full border px-3 py-1 transition-colors ${
                by === g
                  ? 'border-transparent bg-accent text-accent-foreground'
                  : 'border-line hover:text-foreground'
              }`}
            >
              {t(`srcBy.${g}`)}
            </button>
          ))}
        </div>
        {channel && (
          <button
            type="button"
            onClick={() => {
              setChannel(null);
              setData(null);
            }}
            className="rounded-full border border-line px-3 py-1 hover:text-foreground"
          >
            {t('srcChannel', { channel })} ✕
          </button>
        )}
      </div>

      {!data ? (
        <p className="py-6 text-center text-sm text-muted">…</p>
      ) : data.rows.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted">{t('noChannels')}</p>
      ) : (
        <div className="scroll-thin overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="text-left text-xs text-muted">
                <th className="pb-2 pr-3 font-normal">{t(`srcBy.${by}`)}</th>
                {columns.map((c) => (
                  <th key={c.key} className="pb-2 pl-3 text-right font-normal">
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {data.rows.map((r) => (
                <tr key={r.label}>
                  <td className="max-w-[320px] py-2 pr-3">
                    {by === 'channel' ? (
                      <button
                        type="button"
                        title={t('srcDrill')}
                        onClick={() => {
                          setChannel(r.label);
                          setBy('source_medium');
                          setData(null);
                        }}
                        className="max-w-full truncate text-left hover:underline"
                      >
                        {r.label === '(none)' ? t('srcUnattributed') : r.label}
                      </button>
                    ) : (
                      <span className="block truncate" title={r.label}>
                        {r.label === '(none)' ? t('srcUnattributed') : r.label}
                      </span>
                    )}
                  </td>
                  {columns.map((c) => (
                    <td key={c.key} className="tabular py-2 pl-3 text-right">
                      {c.value(r)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
