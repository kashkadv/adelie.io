'use client';

import { useFormatter, useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { InfoTip } from '../ui/info-tip';

interface Window {
  from: string;
  to: string;
  days: number;
  viewsPerDay: number | null;
  favorersPerDay: number | null;
  sales: number;
}
interface Group {
  products: number;
  before: { viewsPerDay: number | null; favorersPerDay: number | null; sales: number };
  after: { viewsPerDay: number | null; favorersPerDay: number | null; sales: number };
  viewsChange: number | null;
  favorersChange: number | null;
}
interface Result {
  since: string | null;
  daysBefore: number;
  daysAfter: number;
  enough: boolean;
  changed: Group;
  unchanged: Group;
  products: {
    id: string;
    changedOn: string | null;
    fields: string[];
    before: Window | null;
    after: Window | null;
  }[];
}

const FIELDS = ['title', 'tags', 'description', 'price', 'quantity', 'sku'] as const;

/**
 * The research's result (ADR-0036): changed products before and after their changes against the
 * unchanged ones over the same days — views and favourites a day, sales; per product, what changed.
 */
export function ResearchResult({
  base,
  version,
  products,
  onOpen,
}: {
  base: string;
  /** Bumped when the products or their changes may have moved. */
  version: number;
  products: { id: string; title: string; imageUrl: string | null }[];
  onOpen: (productId: string) => void;
}) {
  const t = useTranslations('Research.result');
  const format = useFormatter();
  const [data, setData] = useState<Result | null>(null);

  useEffect(() => {
    let cancelled = false;
    api<Result>(`${base}/result`).then(
      (r) => !cancelled && setData(r),
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [base, version]);

  if (!data) return null;
  const date = (d: string) =>
    format.dateTime(new Date(`${d}T00:00:00Z`), {
      day: 'numeric',
      month: 'short',
      timeZone: 'UTC',
    });
  const rate = (v: number | null) =>
    v === null ? '—' : format.number(v, { maximumFractionDigits: v < 10 ? 1 : 0 });
  const change = (v: number | null) =>
    v === null ? null : (
      <span
        className={`ml-1.5 text-xs ${v > 0 ? 'font-medium text-foreground' : v < 0 ? 'text-rose-600 dark:text-rose-400' : 'text-muted'}`}
      >
        {v > 0 ? '+' : ''}
        {v}%
      </span>
    );
  const byId = new Map(products.map((p) => [p.id, p]));
  const fieldLabel = (f: string) =>
    FIELDS.includes(f as (typeof FIELDS)[number]) ? t(`fields.${f as (typeof FIELDS)[number]}`) : f;

  const groupCard = (title: string, g: Group, hint: string) => (
    <div className="rounded-2xl border border-line p-4 text-sm">
      <p className="mb-2 flex items-center gap-1.5 font-medium">
        {title} <span className="text-muted">({g.products})</span>
        <InfoTip text={hint} />
      </p>
      {g.products === 0 ? (
        <p className="text-muted">—</p>
      ) : (
        <dl className="grid gap-1.5">
          <div className="flex justify-between gap-3">
            <dt className="text-muted">{t('viewsPerDay')}</dt>
            <dd className="tabular">
              {rate(g.before.viewsPerDay)} → {rate(g.after.viewsPerDay)}
              {change(g.viewsChange)}
            </dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-muted">{t('favorersPerDay')}</dt>
            <dd className="tabular">
              {rate(g.before.favorersPerDay)} → {rate(g.after.favorersPerDay)}
              {change(g.favorersChange)}
            </dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-muted">{t('sales')}</dt>
            <dd className="tabular">
              {g.before.sales} → {g.after.sales}
            </dd>
          </div>
        </dl>
      )}
    </div>
  );

  const changed = data.products.filter((p) => p.changedOn);

  return (
    <section className="card animate-rise mb-4 rounded-[24px] p-5">
      <h2 className="mb-1 flex items-center gap-1.5 text-sm font-semibold">
        {t('title')}
        <InfoTip text={t('hint')} />
      </h2>
      {!data.since ? (
        <p className="py-3 text-sm text-muted">{t('nothingChanged')}</p>
      ) : (
        <>
          <p className="mb-3 text-xs text-muted">
            {t('period', {
              since: date(data.since),
              before: data.daysBefore,
              after: data.daysAfter,
            })}
          </p>
          {!data.enough && (
            <p className="mb-3 rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-2.5 text-xs text-amber-800 dark:text-amber-300">
              {t('notEnough', {
                date: date(
                  new Date(Date.parse(`${data.since}T00:00:00Z`) + 14 * 86_400_000)
                    .toISOString()
                    .slice(0, 10),
                ),
              })}
            </p>
          )}
          <div className="grid gap-3 md:grid-cols-2">
            {groupCard(t('changed'), data.changed, t('changedHint'))}
            {groupCard(t('unchanged'), data.unchanged, t('unchangedHint'))}
          </div>

          {changed.length > 0 && (
            <div className="scroll-thin mt-4 overflow-x-auto">
              <table className="w-full min-w-[680px] text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted">
                    <th className="pr-3 pb-2 font-normal">{t('colProduct')}</th>
                    <th className="px-3 pb-2 font-normal">{t('colChanged')}</th>
                    <th className="px-3 pb-2 text-right font-normal">{t('viewsPerDay')}</th>
                    <th className="px-3 pb-2 text-right font-normal">{t('favorersPerDay')}</th>
                    <th className="pb-2 pl-3 text-right font-normal">{t('sales')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {changed.map((r) => {
                    const p = byId.get(r.id);
                    return (
                      <tr key={r.id}>
                        <td className="max-w-[280px] py-2 pr-3">
                          <button
                            type="button"
                            onClick={() => onOpen(r.id)}
                            className="flex max-w-full items-center gap-2 text-left hover:underline"
                          >
                            <span className="h-8 w-8 shrink-0 overflow-hidden rounded-lg bg-hover">
                              {p?.imageUrl && (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                  src={p.imageUrl}
                                  alt=""
                                  className="h-full w-full object-cover"
                                />
                              )}
                            </span>
                            <span className="truncate">{p?.title ?? r.id}</span>
                          </button>
                        </td>
                        <td className="px-3 py-2 text-xs whitespace-nowrap">
                          {date(r.changedOn!)} · {r.fields.map(fieldLabel).join(', ')}
                        </td>
                        <td className="tabular px-3 py-2 text-right whitespace-nowrap">
                          {rate(r.before?.viewsPerDay ?? null)} →{' '}
                          {rate(r.after?.viewsPerDay ?? null)}
                        </td>
                        <td className="tabular px-3 py-2 text-right whitespace-nowrap">
                          {rate(r.before?.favorersPerDay ?? null)} →{' '}
                          {rate(r.after?.favorersPerDay ?? null)}
                        </td>
                        <td className="tabular py-2 pl-3 text-right">
                          {r.before?.sales ?? 0} → {r.after?.sales ?? 0}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
}
