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
  productViews: number;
  addToCart: number;
  checkouts: number;
  purchases: number;
  revenue: number | null;
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
  const [data, setData] = useState<{ currency: string | null; rows: Row[] } | null>(null);

  useEffect(() => {
    let cancelled = false;
    const query = new URLSearchParams({ days, by });
    if (channel) query.set('channel', channel);
    void api<{ currency: string | null; rows: Row[] }>(
      `${base}/${accountId}/sources?${query.toString()}`,
    ).then(
      (d) => !cancelled && setData(d),
      () => !cancelled && setData({ currency: null, rows: [] }),
    );
    return () => {
      cancelled = true;
    };
  }, [base, accountId, days, by, channel]);

  const columns: { key: keyof Row; label: string }[] = [
    { key: 'visits', label: t('srcVisits') },
    { key: 'productViews', label: t('srcProductViews') },
    { key: 'addToCart', label: t('srcAddToCart') },
    { key: 'checkouts', label: t('srcCheckouts') },
    { key: 'purchases', label: t('srcPurchases') },
    { key: 'revenue', label: t('srcRevenue') },
  ];
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
                      {c.key === 'revenue' ? money(r.revenue) : format.number(r[c.key] as number)}
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
