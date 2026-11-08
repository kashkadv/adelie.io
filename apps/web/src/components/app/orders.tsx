'use client';

import { ArrowDown, ArrowUp, RefreshCw, ReceiptText, Search, X } from 'lucide-react';
import { useFormatter, useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { PeriodControl, resolveRange, type DateRange, type RangeLabels } from '../ui/date-range';
import { FilterChip } from '../ui/filter-chip';
import { InfoTip } from '../ui/info-tip';
import { ImpressionsChart, type SeriesPoint } from './impressions-chart';
import { OrderDialog } from './order-dialog';
import { EmptyState, PageHeader } from './page-header';
import { minorDigits, useMoney, useSalesBase, useShops } from './sales-data';

type Order = {
  id: string;
  number: string;
  orderedAt: string;
  status: string | null;
  isPaid: boolean | null;
  isShipped: boolean | null;
  units: number;
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
type Money = {
  currency: string;
  sales: number;
  refunds: number;
  fees: { transaction: number; processing: number; listing: number; vat: number };
  feesTotal: number;
  ads: number;
  other: number;
  net: number;
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
  /** Filter options for the period: statuses and countries ('' = unknown). */
  facets: { statuses: string[]; countries: string[] };
  /** What stays with the shop, per currency (payment-account ledger). */
  money: Money[];
  items: Order[];
};

/**
 * What stays with the shop: sales without tax, minus refunds, platform fees (with their parts) and
 * the platform's own ads — from the payment account's ledger.
 */
function MoneyCard({ money }: { money: Money[] | null }) {
  const t = useTranslations('Sales.orders.money');
  const format = useMoney();
  const m = money?.[0];
  const row = (label: string, value: number, opts: { sub?: boolean; hint?: string } = {}) => (
    <li
      className={`flex items-center gap-2 px-1 ${opts.sub ? 'pl-4 text-xs text-muted' : 'text-sm'}`}
    >
      <span className="flex flex-1 items-center gap-1.5">
        {label}
        {opts.hint && <InfoTip text={opts.hint} />}
      </span>
      <span className={`tabular ${value < 0 && !opts.sub ? 'text-muted' : ''}`}>
        {format(value, m!.currency)}
      </span>
    </li>
  );
  return (
    <section className="card animate-rise rounded-[24px] p-5" style={{ animationDelay: '240ms' }}>
      <h2 className="mb-4 flex items-center gap-1.5 px-1 text-lg font-semibold">
        {t('title')}
        <InfoTip text={t('hint')} />
      </h2>
      {!money ? (
        <p className="px-1 text-sm text-muted">…</p>
      ) : !m ? (
        <p className="px-1 text-sm text-muted">{t('none')}</p>
      ) : (
        <>
          <ul className="space-y-2.5">
            {row(t('sales'), m.sales, { hint: t('salesHint') })}
            {m.refunds !== 0 && row(t('refunds'), m.refunds)}
            {row(t('fees'), m.feesTotal, { hint: t('feesHint') })}
            {m.fees.transaction !== 0 && row(t('transaction'), m.fees.transaction, { sub: true })}
            {m.fees.processing !== 0 && row(t('processing'), m.fees.processing, { sub: true })}
            {m.fees.listing !== 0 && row(t('listing'), m.fees.listing, { sub: true })}
            {m.fees.vat !== 0 && row(t('vat'), m.fees.vat, { sub: true })}
            {m.ads !== 0 && row(t('ads'), m.ads, { hint: t('adsHint') })}
            {m.other !== 0 && row(t('other'), m.other)}
          </ul>
          <div className="mt-4 flex items-center justify-between border-t border-line px-1 pt-3">
            <span className="text-sm font-semibold">{t('net')}</span>
            <span className="tabular font-display text-xl font-semibold">
              {format(m.net, m.currency)}
            </span>
          </div>
        </>
      )}
    </section>
  );
}

/** Long periods read better by month than by day. */
const MONTHLY_AFTER_DAYS = 120;

/** Orders of the project's shops (ADR-0018): totals, revenue per day, countries, the orders. */
type SortKey = 'date' | 'amount' | 'units';
type YesNo = '' | 'yes' | 'no';

/** Orders of the project's shops (ADR-0018): totals, revenue, countries, the filterable list. */
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
  const [status, setStatus] = useState('');
  const [paid, setPaid] = useState<YesNo>('');
  const [shipped, setShipped] = useState<YesNo>('');
  const [country, setCountry] = useState('');
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [sort, setSort] = useState<{ key: SortKey; dir: 'desc' | 'asc' }>({
    key: 'date',
    dir: 'desc',
  });
  const [data, setData] = useState<{ key: string; value: Response } | null>(null);
  const [extra, setExtra] = useState<{ key: string; items: Order[] }>({ key: '', items: [] });
  const [loadingMore, setLoadingMore] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    const id = setTimeout(() => setDebounced(search.trim()), 300);
    return () => clearTimeout(id);
  }, [search]);

  const range = resolveRange(period);
  const query = new URLSearchParams({
    ...(range ?? {}),
    ...(shopId ? { accountId: shopId } : {}),
    ...(status ? { status } : {}),
    ...(paid ? { paid } : {}),
    ...(shipped ? { shipped } : {}),
    ...(country ? { country } : {}),
    ...(debounced ? { q: debounced } : {}),
    sort: sort.key,
    dir: sort.dir,
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
  // The previous result stays while the next loads (no flicker on every filter change).
  const shown = data?.value ?? null;
  const fresh = data?.key === key;
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

  const openIndex = openId ? orders.findIndex((o) => o.id === openId) : -1;
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
  const yesNo = (v: boolean | null, yes: string, no: string) => (v === null ? '—' : v ? yes : no);
  const filtered = !!(status || paid || shipped || country || debounced);
  const clearFilters = () => {
    setStatus('');
    setPaid('');
    setShipped('');
    setCountry('');
    setSearch('');
  };
  const sortBy = (k: SortKey) =>
    setSort((s) =>
      s.key === k ? { key: k, dir: s.dir === 'desc' ? 'asc' : 'desc' } : { key: k, dir: 'desc' },
    );
  const sortHeader = (k: SortKey, label: string) => (
    <button
      type="button"
      onClick={() => sortBy(k)}
      aria-pressed={sort.key === k}
      className={`flex items-center gap-1 whitespace-nowrap hover:text-foreground ${
        sort.key === k ? 'font-semibold text-foreground' : ''
      }`}
    >
      {sort.key === k &&
        (sort.dir === 'desc' ? (
          <ArrowDown size={12} aria-hidden="true" />
        ) : (
          <ArrowUp size={12} aria-hidden="true" />
        ))}
      {label}
    </button>
  );
  /** Columns of the list on wide screens: date · items · country · status · paid · shipped · sum. */
  const GRID = 'xl:grid xl:grid-cols-[8rem_minmax(0,1fr)_9rem_9rem_7rem_8rem_8rem] xl:gap-4';

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
              <InfoTip text={t('orders.voidHint')} />
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
        <span className="mx-1 hidden h-6 w-px bg-line sm:block" aria-hidden="true" />
        {shops && shops.length > 1 && (
          <FilterChip
            label={t('shop')}
            value={shopId}
            onChange={setShopId}
            options={shops.map((s) => ({ value: s.id, label: s.displayName || s.username || '' }))}
            clearLabel={tc('clearFilter')}
          />
        )}
        <FilterChip
          label={t('orders.columns.status')}
          value={status}
          onChange={setStatus}
          options={(shown?.facets.statuses ?? []).map((v) => ({
            value: v,
            label: statusLabel(t, v),
          }))}
          clearLabel={tc('clearFilter')}
        />
        <FilterChip
          label={t('orders.columns.paid')}
          value={paid}
          onChange={(v) => setPaid(v as YesNo)}
          options={[
            { value: 'yes', label: t('orders.paidYes') },
            { value: 'no', label: t('orders.paidNo') },
          ]}
          clearLabel={tc('clearFilter')}
        />
        <FilterChip
          label={t('orders.columns.shipped')}
          value={shipped}
          onChange={(v) => setShipped(v as YesNo)}
          options={[
            { value: 'yes', label: t('orders.shippedYes') },
            { value: 'no', label: t('orders.shippedNo') },
          ]}
          clearLabel={tc('clearFilter')}
        />
        <FilterChip
          label={t('orders.columns.country')}
          value={country}
          onChange={setCountry}
          options={(shown?.facets.countries ?? [])
            .map((c) => ({ value: c || '-', label: countryName(c) }))
            .sort((a, b) => a.label.localeCompare(b.label))}
          searchable={(shown?.facets.countries.length ?? 0) > 8}
          searchPlaceholder={t('orders.searchCountries')}
          clearLabel={tc('clearFilter')}
        />
        <span className="xl:hidden">
          <FilterChip
            label={tc('sortBy')}
            value={sort.key}
            onChange={(v) => setSort({ key: v as SortKey, dir: 'desc' })}
            options={(['date', 'amount', 'units'] as const).map((k) => ({
              value: k,
              label: t(`orders.sort.${k}`),
            }))}
            clearable={false}
          />
        </span>
        <label className="ml-auto flex h-9 w-full items-center gap-2 rounded-full border border-line px-3.5 text-sm focus-within:border-[var(--field-focus)] sm:w-64">
          <Search size={15} className="shrink-0 text-muted" aria-hidden="true" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('orders.search')}
            aria-label={t('orders.search')}
            className="w-full min-w-0 bg-transparent outline-none placeholder:text-muted"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch('')}
              aria-label={tc('clearFilter')}
              className="text-muted hover:text-foreground"
            >
              <X size={14} aria-hidden="true" />
            </button>
          )}
        </label>
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

      <div className="mb-4 grid items-start gap-4 xl:grid-cols-3">
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
        <div className="grid gap-4">
          <MoneyCard money={shown?.money ?? null} />
          <section
            className="card animate-rise rounded-[24px] p-5"
            style={{ animationDelay: '260ms' }}
          >
            <h2 className="mb-4 px-1 text-lg font-semibold">{t('orders.countries')}</h2>
            {countryTotal ? (
              <ul className="space-y-3">
                {shown!.countries.slice(0, 6).map((c) => (
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
      </div>

      {/* The list: full width, sortable columns, every row opens the order card. */}
      <section
        className={`card animate-rise rounded-[24px] transition-opacity ${fresh ? '' : 'opacity-60'}`}
        style={{ animationDelay: '300ms' }}
      >
        <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-4">
          <h2 className="text-lg font-semibold">{t('orders.list')}</h2>
          {filtered && (
            <button
              type="button"
              onClick={clearFilters}
              className="text-sm text-muted hover:text-foreground"
            >
              {t('orders.clearFilters')}
            </button>
          )}
        </div>
        <div className={`hidden border-b border-line px-5 py-3 text-xs text-muted ${GRID}`}>
          {sortHeader('date', t('orders.columns.date'))}
          <span>{sortHeader('units', t('orders.columns.items'))}</span>
          <span>{t('orders.columns.country')}</span>
          <span>{t('orders.columns.status')}</span>
          <span>{t('orders.columns.paid')}</span>
          <span>{t('orders.columns.shipped')}</span>
          <span className="flex justify-end">
            {sortHeader('amount', t('orders.columns.amount'))}
          </span>
        </div>
        {!shown ? (
          <p className="px-5 py-10 text-center text-sm text-muted">…</p>
        ) : orders.length === 0 ? (
          <p className="px-5 py-14 text-center text-sm text-muted">
            {filtered ? t('orders.noMatches') : t('orders.none')}
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {orders.map((o) => {
              const first = o.items[0];
              const voided =
                !!o.status &&
                ['canceled', 'cancelled', 'fully refunded'].includes(o.status.toLowerCase());
              return (
                <li key={o.id}>
                  <button
                    type="button"
                    onClick={() => setOpenId(o.id)}
                    aria-haspopup="dialog"
                    className={`flex w-full flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3 text-left text-sm transition-colors hover:bg-hover xl:items-center ${GRID}`}
                  >
                    <span className="tabular w-32 shrink-0 whitespace-nowrap text-muted xl:w-auto">
                      {format.dateTime(new Date(o.orderedAt), {
                        day: 'numeric',
                        month: 'short',
                        year: 'numeric',
                      })}
                    </span>
                    <span className="flex min-w-0 flex-1 basis-60 items-center gap-3 xl:basis-auto">
                      <span className="flex shrink-0 -space-x-3">
                        {o.items.slice(0, 3).map((i) => (
                          <span
                            key={i.id}
                            className="h-10 w-10 overflow-hidden rounded-lg border-2 border-[var(--card)] bg-hover"
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
                      <span className="min-w-0">
                        <span
                          className={`block truncate ${voided ? 'text-muted line-through' : ''}`}
                        >
                          {first?.title ?? first?.product?.title ?? t('orders.noTitle')}
                        </span>
                        <span className="block text-xs text-muted">
                          №{o.number} · {t('orders.units', { count: o.units })}
                          {o.items.length > 1 &&
                            ` · ${t('orders.more', { count: o.items.length - 1 })}`}
                        </span>
                      </span>
                    </span>
                    <span className="w-full truncate text-muted sm:w-36 xl:w-auto">
                      {o.country ? countryName(o.country) : '—'}
                    </span>
                    <span className="xl:w-auto">
                      <span
                        className={`inline-block rounded-full px-2 text-xs leading-5 whitespace-nowrap ${
                          voided ? 'bg-rose-500/15 text-rose-700 dark:text-rose-300' : 'bg-hover'
                        }`}
                      >
                        {o.status ? statusLabel(t, o.status) : '—'}
                      </span>
                    </span>
                    <span className="whitespace-nowrap text-muted">
                      {yesNo(o.isPaid, t('orders.paidYes'), t('orders.paidNo'))}
                    </span>
                    <span className="whitespace-nowrap text-muted">
                      {yesNo(o.isShipped, t('orders.shippedYes'), t('orders.shippedNo'))}
                    </span>
                    <span
                      className={`tabular ml-auto text-right font-medium whitespace-nowrap xl:ml-0 ${
                        voided ? 'text-muted line-through' : ''
                      }`}
                    >
                      {money(o.revenue, o.currency)}
                    </span>
                  </button>
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

      {openId && base && (
        <OrderDialog
          base={base}
          orderId={openId}
          onClose={() => setOpenId(null)}
          onPrevious={openIndex > 0 ? () => setOpenId(orders[openIndex - 1]!.id) : undefined}
          onNext={
            openIndex >= 0 && openIndex < orders.length - 1
              ? () => setOpenId(orders[openIndex + 1]!.id)
              : undefined
          }
        />
      )}
    </>
  );
}

/** Etsy statuses come in English ("Completed"); known ones are translated, others shown as is. */
const KNOWN_STATUSES = [
  'paid',
  'completed',
  'open',
  'payment processing',
  'canceled',
  'fully refunded',
  'partially refunded',
];
function statusLabel(t: ReturnType<typeof useTranslations<'Sales'>>, status: string): string {
  const k = status.toLowerCase();
  return KNOWN_STATUSES.includes(k)
    ? t(`orders.statuses.${k.replace(/ /g, '_')}` as 'orders.statuses.paid')
    : status;
}
