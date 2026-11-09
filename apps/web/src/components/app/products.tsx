'use client';

import {
  ArrowDown,
  Check,
  CircleAlert,
  ExternalLink,
  Package,
  PenLine,
  Pin,
  Search,
  X,
} from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { PeriodControl, resolveRange, type DateRange, type RangeLabels } from '../ui/date-range';
import { FilterChip } from '../ui/filter-chip';
import { InfoTip } from '../ui/info-tip';
import { EmptyState, PageHeader } from './page-header';
import { ProductDialog } from './product-dialog';
import { ProductEditor } from './product-editor';
import {
  ISSUE_LEVELS,
  ISSUE_STYLE,
  sortIssues,
  topIssueLevel,
  type IssueLevel,
  type ProductIssue,
} from './product-issues';
import { useMoney, useSalesBase, useShops } from './sales-data';

type Product = {
  id: string;
  title: string;
  url: string | null;
  imageUrl: string | null;
  state: string;
  price: number | null;
  currency: string | null;
  quantity: number | null;
  views: number | null;
  favorers: number | null;
  skus: string[];
  listedAt: string | null;
  sold: number;
  revenue: number;
  /** Posts (pins) leading to the product. */
  posts: number;
  issues: ProductIssue[];
};
type Response = { period: { from: string; to: string } | null; items: Product[] };

const COLUMNS = ['price', 'quantity', 'views', 'favorers', 'sold', 'revenue'] as const;
type Column = (typeof COLUMNS)[number];
const STATES = ['active', 'inactive', 'sold_out', 'draft', 'expired', 'removed'] as const;

/**
 * The product's health as one icon in a column of its own before the photo: a coloured alert by
 * the most serious problem (hover or focus lists them, worst first), or a green check when there
 * are none — so the column is never empty.
 */
function Issues({ product }: { product: Product }) {
  const t = useTranslations('Sales.issues');
  const top = topIssueLevel(product.issues);
  if (!top) {
    return (
      <InfoTip
        text={t('none')}
        trigger={<Check size={16} strokeWidth={2.25} aria-hidden="true" />}
        triggerClassName="text-emerald-600 dark:text-emerald-400"
      />
    );
  }
  return (
    <InfoTip
      text={t('count', { count: product.issues.length })}
      lines={sortIssues(product.issues).map((i) => ({
        text: t(`codes.${i.code}`),
        dotClassName: ISSUE_STYLE[i.level].dot,
      }))}
      trigger={<CircleAlert size={16} aria-hidden="true" />}
      triggerClassName={ISSUE_STYLE[top].text}
    />
  );
}

/** Products of the project's shops (ADR-0018): what sells, what is seen, what is in stock. */
export function Products() {
  const t = useTranslations('Sales');
  const tc = useTranslations('Content');
  const format = useFormatter();
  const money = useMoney();
  const base = useSalesBase();
  const shops = useShops();
  const [shopId, setShopId] = useState('');
  const [period, setPeriod] = useState<DateRange>({ preset: 'all' });
  const [state, setState] = useState('active');
  /** Products with posts leading to them (ADR-0018): '' = all. */
  const [pins, setPins] = useState<'' | 'with' | 'without'>('');
  /** Problems filter: '' = all, 'any' = with any problem, else the most serious level. */
  const [issues, setIssues] = useState('');
  const [sort, setSort] = useState<Column>('revenue');
  const [search, setSearch] = useState('');
  const [data, setData] = useState<{ key: string; value: Response } | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  /** Bumped after a save: the list reloads with the new values. */
  const [version, setVersion] = useState(0);

  const range = resolveRange(period);
  const query = new URLSearchParams({
    ...(range ?? {}),
    ...(shopId ? { accountId: shopId } : {}),
  }).toString();
  const key = `${base}?${query}`;

  useEffect(() => {
    if (!base) return;
    let cancelled = false;
    api<Response>(`${base}/products?${query}`).then(
      (value) => !cancelled && setData({ key: `${base}?${query}`, value }),
      () => !cancelled && setData({ key: `${base}?${query}`, value: { period: null, items: [] } }),
    );
    return () => {
      cancelled = true;
    };
  }, [base, query, version]);
  const shown = data?.key === key ? data.value : null;

  const states = useMemo(
    () => STATES.filter((s) => shown?.items.some((p) => p.state === s)),
    [shown],
  );
  const items = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = (shown?.items ?? []).filter(
      (p) =>
        (!state || p.state === state) &&
        (!pins || (pins === 'with' ? p.posts > 0 : p.posts === 0)) &&
        (!issues ||
          (issues === 'any' ? p.issues.length > 0 : topIssueLevel(p.issues) === issues)) &&
        (!q ||
          p.title.toLowerCase().includes(q) ||
          p.skus.some((x) => x.toLowerCase().includes(q))),
    );
    // Highest first; no data last; then newest listing.
    return list.sort((a, b) => {
      const va = a[sort];
      const vb = b[sort];
      if (va !== vb) {
        if (va === null) return 1;
        if (vb === null) return -1;
        return vb - va;
      }
      return (b.listedAt ?? '').localeCompare(a.listedAt ?? '');
    });
  }, [shown, state, pins, issues, search, sort]);

  const openIndex = openId ? items.findIndex((p) => p.id === openId) : -1;

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
        <PageHeader title={t('products.title')} subtitle={t('products.subtitle')} />
        <EmptyState
          icon={<Package size={24} strokeWidth={1.75} aria-hidden="true" />}
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

  const cell = (p: Product, c: Column) => {
    if (c === 'price') return money(p.price, p.currency);
    if (c === 'revenue') return p.revenue ? money(p.revenue, p.currency) : '—';
    const v = p[c];
    return v === null ? '—' : format.number(v);
  };

  return (
    <>
      <PageHeader
        title={t('products.title')}
        subtitle={
          shown ? (
            <span className="flex flex-wrap items-center gap-x-1.5">
              {t('products.count', { count: items.length })}
              <span aria-hidden="true">·</span>
              {shown.period ? t('salesForPeriod') : t('salesAllTime')}
              <InfoTip text={t('products.hint')} />
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
          label={t('products.state')}
          value={state}
          onChange={setState}
          options={states.map((s) => ({ value: s, label: t(`states.${s}`) }))}
          clearLabel={tc('clearFilter')}
        />
        <FilterChip
          label={t('products.pins')}
          value={pins}
          onChange={(v) => {
            setPins(v as '' | 'with' | 'without');
            // Pins often lead to products that are gone from the shop: show every state then.
            if (v === 'with') setState('');
          }}
          options={(['with', 'without'] as const).map((v) => ({
            value: v,
            label: t(`products.pinsFilter.${v}`),
          }))}
          clearLabel={tc('clearFilter')}
        />
        <FilterChip
          label={t('issues.filter')}
          value={issues}
          onChange={(v) => {
            setIssues(v);
            // A pin to a product that is not on sale lives in a non-active state.
            if (v) setState('');
          }}
          options={[
            { value: 'any', label: t('issues.any') },
            ...ISSUE_LEVELS.map((l) => ({
              value: l,
              label: t(`issues.levels.${l as IssueLevel}`),
            })),
          ]}
          clearLabel={tc('clearFilter')}
        />
        <span className="xl:hidden">
          <FilterChip
            label={tc('sortBy')}
            value={sort}
            onChange={(v) => setSort(v as Column)}
            options={COLUMNS.map((c) => ({ value: c, label: t(`products.columns.${c}`) }))}
            clearable={false}
          />
        </span>
        <label className="ml-auto flex h-9 w-full items-center gap-2 rounded-full border border-line px-3.5 text-sm focus-within:border-[var(--field-focus)] sm:w-56">
          <Search size={15} className="shrink-0 text-muted" aria-hidden="true" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('products.search')}
            aria-label={t('products.search')}
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

      <section className="card animate-rise rounded-[24px]">
        <div className="hidden items-center gap-6 border-b border-line p-5 text-xs text-muted xl:flex">
          <span className="flex-1 pl-[100px]">{t('products.product')}</span>
          <span className="grid w-[46rem] grid-cols-6 gap-6 text-right">
            {COLUMNS.map((c) => (
              <span key={c} className="flex items-center justify-end gap-1.5">
                <button
                  type="button"
                  onClick={() => setSort(c)}
                  aria-pressed={sort === c}
                  className={`flex items-center gap-1 whitespace-nowrap hover:text-foreground ${sort === c ? 'font-semibold text-foreground' : ''}`}
                >
                  {sort === c && <ArrowDown size={12} aria-hidden="true" />}
                  {t(`products.columns.${c}`)}
                </button>
                <InfoTip text={t(`products.hints.${c}`)} />
              </span>
            ))}
          </span>
          <span className="w-16" />
        </div>
        {!shown ? (
          <p className="px-5 py-10 text-center text-sm text-muted">…</p>
        ) : items.length === 0 ? (
          <p className="px-5 py-14 text-center text-sm text-muted">{t('products.noMatches')}</p>
        ) : (
          <ul className="divide-y divide-line">
            {items.map((p) => (
              <li
                key={p.id}
                className="flex flex-wrap items-center gap-x-6 gap-y-3 px-5 py-3 xl:flex-nowrap"
              >
                {/* The product itself opens its card (sales, orders, pins). */}
                <div className="flex min-w-0 flex-1 basis-72 items-center gap-3">
                  <span className="flex w-5 shrink-0 justify-center">
                    <Issues product={p} />
                  </span>
                  <button
                    type="button"
                    onClick={() => setOpenId(p.id)}
                    aria-haspopup="dialog"
                    className="group flex min-w-0 flex-1 items-center gap-3 rounded-xl text-left"
                  >
                    <span className="h-14 w-14 shrink-0 overflow-hidden rounded-xl bg-hover transition-transform duration-200 group-hover:scale-[1.04]">
                      {p.imageUrl && (
                        // External platform image: plain <img>, lazy.
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={p.imageUrl}
                          alt=""
                          loading="lazy"
                          className="h-full w-full object-cover"
                        />
                      )}
                    </span>
                    <div className="min-w-0">
                      <p
                        className="truncate text-sm font-medium group-hover:underline group-hover:underline-offset-2"
                        title={p.title}
                      >
                        {p.title}
                      </p>
                      <p className="flex items-center gap-2 text-xs text-muted">
                        {p.state !== 'active' && (
                          <span className="rounded-full border border-line px-1.5 leading-4">
                            {t(`states.${p.state as (typeof STATES)[number]}`)}
                          </span>
                        )}
                        {p.posts > 0 && (
                          <span
                            className="flex items-center gap-1 rounded-full bg-hover px-1.5 leading-4 text-foreground"
                            title={t('products.postsHint')}
                          >
                            <Pin size={11} aria-hidden="true" />
                            {t('products.posts', { count: p.posts })}
                          </span>
                        )}
                        {p.skus.length > 0 && (
                          <span className="tabular truncate" title={p.skus.join(', ')}>
                            {p.skus.length > 2
                              ? `${p.skus.slice(0, 2).join(', ')} +${p.skus.length - 2}`
                              : p.skus.join(', ')}
                          </span>
                        )}
                        {p.listedAt &&
                          t('products.listed', {
                            date: format.dateTime(new Date(p.listedAt), {
                              day: 'numeric',
                              month: 'short',
                              year: 'numeric',
                            }),
                          })}
                      </p>
                    </div>
                  </button>
                </div>
                <dl className="tabular grid shrink-0 grid-cols-3 gap-x-6 gap-y-2 text-right sm:grid-cols-6 xl:w-[46rem]">
                  {COLUMNS.map((c) => (
                    <div key={c}>
                      <dt className="text-[11px] text-muted xl:sr-only">
                        {t(`products.columns.${c}`)}
                      </dt>
                      <dd
                        className={`text-sm whitespace-nowrap ${sort === c ? 'font-semibold' : 'text-muted'}`}
                      >
                        {cell(p, c)}
                      </dd>
                    </div>
                  ))}
                </dl>
                <span className="flex w-16 shrink-0 justify-end">
                  {p.state !== 'removed' && (
                    <button
                      type="button"
                      onClick={() => setEditing(p.id)}
                      className="icon-btn h-8 w-8"
                      aria-label={t('products.edit')}
                      title={t('products.edit')}
                    >
                      <PenLine size={15} aria-hidden="true" />
                    </button>
                  )}
                  {p.url && (
                    <a
                      href={p.url}
                      target="_blank"
                      rel="noreferrer"
                      className="icon-btn h-8 w-8"
                      aria-label={tc('openOnPlatform', { platform: 'Etsy' })}
                      title={tc('openOnPlatform', { platform: 'Etsy' })}
                    >
                      <ExternalLink size={15} aria-hidden="true" />
                    </a>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {openId && base && (
        <ProductDialog
          base={base}
          productId={openId}
          issues={items[openIndex]?.issues}
          onClose={() => setOpenId(null)}
          onPrevious={openIndex > 0 ? () => setOpenId(items[openIndex - 1]!.id) : undefined}
          onNext={
            openIndex >= 0 && openIndex < items.length - 1
              ? () => setOpenId(items[openIndex + 1]!.id)
              : undefined
          }
          onEdit={
            items[openIndex]?.state !== 'removed'
              ? () => {
                  setEditing(openId);
                  setOpenId(null);
                }
              : undefined
          }
        />
      )}

      {editing && base && (
        <ProductEditor
          base={base}
          productId={editing}
          onClose={() => setEditing(null)}
          onSaved={() => setVersion((v) => v + 1)}
        />
      )}
    </>
  );
}
