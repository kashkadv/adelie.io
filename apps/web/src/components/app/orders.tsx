'use client';

import { RefreshCw, ReceiptText } from 'lucide-react';
import { useFormatter, useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { PeriodControl, resolveRange, type DateRange, type RangeLabels } from '../ui/date-range';
import { FilterChip } from '../ui/filter-chip';
import { InfoTip } from '../ui/info-tip';
import { ImpressionsChart, type SeriesPoint } from './impressions-chart';
import { EmptyState, PageHeader } from './page-header';
import { minorDigits, useMoney, useSalesBase, useShops } from './sales-data';

type Order = {
  id: string;
  externalId: string;
  orderedAt: string;
  status: string | null;
  currency: string;
  revenue: number | null;
  tax: number | null;
  shipping: number | null;
  country: string | null;
  items: {
    id: string;
    title: string | null;
    quantity: number;
    product: { id: string; imageUrl: string | null; title: string } | null;
  }[];
};
type Totals = { currency: string; orders: number; units: number; revenue: number; tax: number };
type Response = {
  period: { from: string; to: string } | null;
  total: number;
  pageSize: number;
  totals: Totals[];
  series: { date: string; revenue: number; orders: number }[];
  seriesCurrency: string | null;
  countries: { country: string; orders: number }[];
  items: Order[];
};

/** Long periods read better by month than by day. */
const MONTHLY_AFTER_DAYS = 120;

/** Orders of the project's shops (ADR-0018): totals, revenue per day, countries, the orders. */
export function Orders() {
  const t = useTranslations('Sales');
  const tc = useTranslations('Content');
  const format = useFormatter();
  const locale = useLocale();
  const money = useMoney();
  const base = useSalesBase();
  const shops = useShops();
  const [shopId, setShopId] = useState('');
  // A year by default: a small shop has a handful of orders a month.
  const [period, setPeriod] = useState<DateRange>({ preset: '12m' });
  const [data, setData] = useState<{ key: string; value: Response } | null>(null);
  const [extra, setExtra] = useState<{ key: string; items: Order[] }>({ key: '', items: [] });
  const [loadingMore, setLoadingMore] = useState(false);

  const range = resolveRange(period);
  const query = new URLSearchParams({
    ...(range ?? {}),
    ...(shopId ? { accountId: shopId } : {}),
  }).toString();
  const key = `${base}?${query}`;

  useEffect(() => {
    if (!base) return;
    let cancelled = false;
    api<Response>(`${base}/orders?${query}`).then(
      (value) => !cancelled && setData({ key: `${base}?${query}`, value }),
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [base, query]);
  const shown = data?.key === key ? data.value : null;
  const orders = [...(shown?.items ?? []), ...(extra.key === key ? extra.items : [])];

  async function loadMore() {
    if (!base || !shown) return;
    setLoadingMore(true);
    try {
      const page = Math.floor(orders.length / shown.pageSize);
      const next = await api<Response>(`${base}/orders?${query}&page=${page}`);
      setExtra((e) => ({ key, items: [...(e.key === key ? e.items : []), ...next.items] }));
    } finally {
      setLoadingMore(false);
    }
  }

  const main = shown?.totals[0];
  const currency = shown?.seriesCurrency ?? main?.currency ?? null;
  // Revenue per day (or month for long periods), in currency units for the chart.
  const points: SeriesPoint[] = useMemo(() => {
    const series = shown?.series ?? [];
    const unit = (minor: number) => (currency ? minor / 10 ** minorDigits(currency) : minor);
    if (series.length <= MONTHLY_AFTER_DAYS) {
      return series.map((d) => ({ date: d.date, value: unit(d.revenue), status: 'READY' }));
    }
    const months = new Map<string, number>();
    for (const d of series) {
      const m = `${d.date.slice(0, 7)}-01`;
      months.set(m, (months.get(m) ?? 0) + d.revenue);
    }
    return [...months].map(([date, v]) => ({ date, value: unit(v), status: 'READY' }));
  }, [shown, currency]);
  const monthly = (shown?.series.length ?? 0) > MONTHLY_AFTER_DAYS;
  const countryName = useMemo(() => {
    const names = new Intl.DisplayNames([locale], { type: 'region' });
    return (code: string) => {
      try {
        return code ? (names.of(code) ?? code) : t('orders.unknownCountry');
      } catch {
        return code;
      }
    };
  }, [locale, t]);

  const labels: RangeLabels = {
    all: tc('period.all'),
    '7d': tc('period.7d'),
    '30d': tc('period.30d'),
    '12m': tc('period.12m'),
    custom: tc('period.custom'),
    previous: tc('period.previous'),
    next: tc('period.next'),
    clear: tc('clearFilter'),
  };

  if (shops && shops.length === 0) {
    return (
      <>
        <PageHeader title={t('orders.title')} subtitle={t('orders.subtitle')} />
        <EmptyState
          icon={<ReceiptText size={24} strokeWidth={1.75} aria-hidden="true" />}
          title={t('noShopsTitle')}
          text={t('noShopsText')}
          action={
            <Link href="/connections" className="btn-primary w-auto px-5">
              {t('connectShop')}
            </Link>
          }
        />
      </>
    );
  }

  const kpis: { id: 'orders' | 'revenue' | 'average' | 'units'; value: string }[] = [
    { id: 'orders', value: main ? format.number(main.orders) : '—' },
    { id: 'revenue', value: main ? money(main.revenue, main.currency) : '—' },
    {
      id: 'average',
      value: main?.orders ? money(Math.round(main.revenue / main.orders), main.currency) : '—',
    },
    { id: 'units', value: main ? format.number(main.units) : '—' },
  ];
  const countryTotal = shown?.countries.reduce((n, c) => n + c.orders, 0) ?? 0;

  return (
    <>
      <PageHeader
        title={t('orders.title')}
        subtitle={
          shown ? (
            <span className="flex flex-wrap items-center gap-x-1.5">
              {t('orders.count', { count: shown.total })}
              {shown.totals.length > 1 && (
                <>
                  <span aria-hidden="true">·</span>
                  {t('orders.currencies', { currency: main?.currency ?? '' })}
                </>
              )}
            </span>
          ) : (
            ' '
          )
        }
      />

      <div className="animate-rise relative z-20 mb-4 flex flex-wrap items-center gap-2">
        <PeriodControl
          value={period}
          onChange={setPeriod}
          labels={labels}
          ariaLabel={tc('period.label')}
        />
        {shops && shops.length > 1 && (
          <FilterChip
            label={t('shop')}
            value={shopId}
            onChange={setShopId}
            options={shops.map((s) => ({ value: s.id, label: s.displayName || s.username || '' }))}
            clearLabel={tc('clearFilter')}
          />
        )}
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {kpis.map((k, i) => (
          <article
            key={k.id}
            className="card animate-rise rounded-[24px] p-5"
            style={{ animationDelay: `${40 + i * 40}ms` }}
          >
            <p className="flex items-center gap-1.5 text-sm text-muted">
              {t(`orders.kpis.${k.id}`)}
              <InfoTip text={t(`orders.hints.${k.id}`)} />
            </p>
            <p className="tabular mt-3 font-display text-3xl font-semibold">{k.value}</p>
          </article>
        ))}
      </div>

      <div className="mb-4 grid gap-4 xl:grid-cols-3">
        <section
          className="card animate-rise rounded-[24px] p-5 xl:col-span-2"
          style={{ animationDelay: '200ms' }}
        >
          <h2 className="mb-3 flex items-center gap-1.5 px-1 text-lg font-semibold">
            {monthly ? t('orders.chartMonthly') : t('orders.chartDaily')}
            <InfoTip text={t('orders.hints.revenue')} />
          </h2>
          {points.length ? (
            <ImpressionsChart
              points={points}
              ariaLabel={monthly ? t('orders.chartMonthly') : t('orders.chartDaily')}
              formatValue={(v) =>
                currency ? money(Math.round(v * 10 ** minorDigits(currency)), currency) : String(v)
              }
            />
          ) : (
            <p className="px-1 py-10 text-center text-sm text-muted">{t('orders.none')}</p>
          )}
        </section>

        <section
          className="card animate-rise rounded-[24px] p-5"
          style={{ animationDelay: '240ms' }}
        >
          <h2 className="mb-4 px-1 text-lg font-semibold">{t('orders.countries')}</h2>
          {countryTotal ? (
            <ul className="space-y-3">
              {shown!.countries.slice(0, 8).map((c) => (
                <li key={c.country} className="flex items-center gap-3 px-1 text-sm">
                  <span className="flex-1 truncate">{countryName(c.country)}</span>
                  <span className="tabular text-muted">
                    {format.number(c.orders / countryTotal, {
                      style: 'percent',
                      maximumFractionDigits: 0,
                    })}
                  </span>
                  <span className="tabular w-10 text-right font-medium">
                    {format.number(c.orders)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-1 text-sm text-muted">{t('orders.none')}</p>
          )}
        </section>
      </div>

      <section className="card animate-rise rounded-[24px]" style={{ animationDelay: '280ms' }}>
        <h2 className="border-b border-line px-5 py-4 text-lg font-semibold">{t('orders.list')}</h2>
        {!shown ? (
          <p className="px-5 py-10 text-center text-sm text-muted">…</p>
        ) : orders.length === 0 ? (
          <p className="px-5 py-14 text-center text-sm text-muted">{t('orders.none')}</p>
        ) : (
          <ul className="divide-y divide-line">
            {orders.map((o) => {
              const first = o.items[0];
              const units = o.items.reduce((n, i) => n + i.quantity, 0);
              return (
                <li key={o.id} className="flex flex-wrap items-center gap-x-6 gap-y-2 px-5 py-3">
                  <span className="tabular w-24 shrink-0 text-sm text-muted">
                    {format.dateTime(new Date(o.orderedAt), {
                      day: 'numeric',
                      month: 'short',
                      year: 'numeric',
                    })}
                  </span>
                  <div className="flex min-w-0 flex-1 basis-60 items-center gap-3">
                    <span className="flex shrink-0 -space-x-3">
                      {o.items.slice(0, 3).map((i) => (
                        <span
                          key={i.id}
                          className="h-10 w-10 overflow-hidden rounded-lg border-2 border-[var(--surface,transparent)] bg-hover"
                        >
                          {i.product?.imageUrl && (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={i.product.imageUrl}
                              alt=""
                              loading="lazy"
                              className="h-full w-full object-cover"
                            />
                          )}
                        </span>
                      ))}
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-sm">
                        {first?.title ?? first?.product?.title ?? t('orders.noTitle')}
                      </p>
                      <p className="text-xs text-muted">
                        {t('orders.units', { count: units })}
                        {o.items.length > 1 &&
                          ` · ${t('orders.more', { count: o.items.length - 1 })}`}
                      </p>
                    </div>
                  </div>
                  <span className="w-32 shrink-0 truncate text-sm text-muted">
                    {o.country ? countryName(o.country) : '—'}
                  </span>
                  <span className="tabular w-28 shrink-0 text-right text-sm font-medium">
                    {money(o.revenue, o.currency)}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
        {shown && orders.length < shown.total && (
          <div className="border-t border-line p-3 text-center">
            <button
              type="button"
              onClick={loadMore}
              disabled={loadingMore}
              className="inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm text-muted hover:bg-hover hover:text-foreground"
            >
              {loadingMore && <RefreshCw size={14} className="animate-spin" aria-hidden="true" />}
              {tc('loadMore', { count: shown.total - orders.length })}
            </button>
          </div>
        )}
      </section>
    </>
  );
}
