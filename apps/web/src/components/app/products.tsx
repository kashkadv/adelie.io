'use client';

import {
  ArrowDown,
  Check,
  ChevronDown,
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
import { Segmented } from '../ui/segmented';
import { InfoTip } from '../ui/info-tip';
import { EmptyState, PageHeader } from './page-header';
import { IssuesFilter } from './issues-filter';
import { ProductDialog } from './product-dialog';
import { ProductEditor } from './product-editor';
import {
  ISSUE_STYLE,
  sortIssues,
  topIssueLevel,
  type IssueCode,
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
  /** null = not known (a site has no orders): shown as "—", never as 0. */
  sold: number | null;
  revenue: number | null;
  /** Posts (pins) leading to the product. */
  posts: number;
  /** The shop or site the product is in. */
  account: { id: string; username: string | null; platform: 'ETSY' | 'WEBSITE' };
  issues: ProductIssue[];
  /** Problems the user marked "on purpose". */
  ignored: ProductIssue[];
  /** The same article on the other channels (ADR-0021). */
  elsewhere: {
    id: string;
    title: string;
    url: string | null;
    imageUrl: string | null;
    state: string;
    price: number | null;
    currency: string | null;
    account: {
      id: string;
      platform: 'ETSY' | 'WEBSITE';
      username: string | null;
      displayName: string | null;
    };
  }[];
};
type Response = { period: { from: string; to: string } | null; items: Product[] };

/** What each kind of channel offers: a shop has sales and views, a site's feed only a price. */
const SHOP_COLUMNS = ['price', 'quantity', 'views', 'favorers', 'sold', 'revenue'] as const;
const SITE_COLUMNS = ['price'] as const;
type Column = (typeof SHOP_COLUMNS)[number];
/** How long a row stays lit after its dialog closes, before it fades out. */
const LIT_AFTER_CLOSE_MS = 1500;
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
        text: t(`codes.${i.code}`, i.params),
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
  const shops = useShops(true);
  /** The channel (shop or site) whose products are shown; the first one until chosen. */
  const [chosen, setChosen] = useState('');
  /** On / not on another channel: '', 'has:<id>', 'lacks:<id>' or 'lacksSites'. */
  const [presence, setPresence] = useState('');
  /** Rows opened to show the same product on the other channels. */
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [period, setPeriod] = useState<DateRange>({ preset: 'all' });
  const [state, setState] = useState('active');
  /** Products with posts leading to them (ADR-0018): '' = all. */
  const [pins, setPins] = useState<'' | 'with' | 'without'>('');
  /** Problems filter: the chosen problems; a product matches if it has any of them. */
  const [issueCodes, setIssueCodes] = useState<IssueCode[]>([]);
  const [sortChoice, setSortChoice] = useState<Column>('revenue');
  const [search, setSearch] = useState('');
  const [data, setData] = useState<{ key: string; value: Response } | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  /**
   * The row of the product a dialog is open for stays lit; after the dialog closes the light holds
   * a moment and fades out, so it is easy to see which product was just worked on.
   */
  const active = openId ?? editing;
  const [lastActive, setLastActive] = useState<string | null>(null);
  const [holding, setHolding] = useState(false);
  if (active && (active !== lastActive || !holding)) {
    setLastActive(active);
    setHolding(true);
  }
  useEffect(() => {
    if (active) return;
    const timer = setTimeout(() => setHolding(false), LIT_AFTER_CLOSE_MS);
    return () => clearTimeout(timer);
  }, [active]);
  const lit = active ?? (holding ? lastActive : null);
  /** Bumped after a save: the list reloads with the new values. */
  const [version, setVersion] = useState(0);

  const channel = shops?.find((s) => s.id === chosen) ?? shops?.[0];
  const isSite = channel?.platform === 'WEBSITE';
  const columns: readonly Column[] = isSite ? SITE_COLUMNS : SHOP_COLUMNS;
  // The chosen sort may not exist on this channel (a site has only a price).
  const sort = columns.includes(sortChoice) ? sortChoice : columns[0]!;
  // Sales of a period exist only for a shop.
  const range = isSite ? null : resolveRange(period);
  const query = new URLSearchParams({
    ...(range ?? {}),
    ...(channel ? { accountId: channel.id } : {}),
  }).toString();
  const key = `${base}?${query}`;

  useEffect(() => {
    if (!base || !channel) return;
    let cancelled = false;
    api<Response>(`${base}/products?${query}`).then(
      (value) => !cancelled && setData({ key: `${base}?${query}`, value }),
      () => !cancelled && setData({ key: `${base}?${query}`, value: { period: null, items: [] } }),
    );
    return () => {
      cancelled = true;
    };
  }, [base, query, version, channel]);
  const shown = channel && data?.key === key ? data.value : null;

  const states = useMemo(
    () => STATES.filter((s) => shown?.items.some((p) => p.state === s)),
    [shown],
  );
  /** How many products have each problem, for the problems filter. */
  const issueCounts = useMemo(() => {
    const counts: Partial<Record<IssueCode, number>> = {};
    for (const p of shown?.items ?? []) {
      for (const i of p.issues) counts[i.code] = (counts[i.code] ?? 0) + 1;
    }
    return counts;
  }, [shown]);
  /** The other channels a product can be on, for the "on / not on" filter. */
  const others = (shops ?? []).filter((s) => s.id !== channel?.id);
  const matchesPresence = (p: Product) => {
    if (!presence) return true;
    const [mode, id] = presence.split(':');
    const on = (accountId?: string) => p.elsewhere.some((e) => e.account.id === accountId);
    if (mode === 'has') return on(id);
    if (mode === 'lacks') return !on(id);
    // 'lacksSites': on none of the sites.
    return !others.filter((o) => o.platform === 'WEBSITE').some((o) => on(o.id));
  };
  const items = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = (shown?.items ?? []).filter(
      (p) =>
        (!state || p.state === state) &&
        (!pins || (pins === 'with' ? p.posts > 0 : p.posts === 0)) &&
        matchesPresence(p) &&
        (!issueCodes.length || p.issues.some((i) => issueCodes.includes(i.code))) &&
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `matchesPresence` follows `presence`
  }, [shown, state, pins, issueCodes, presence, search, sort]);

  const openIndex = openId ? items.findIndex((p) => p.id === openId) : -1;

  /** Switching the channel drops what only made sense on the previous one. */
  const switchChannel = (id: string) => {
    setChosen(id);
    setPresence('');
    setIssueCodes([]);
    setPins('');
    setExpanded(new Set());
  };
  const toggleExpanded = (id: string) =>
    setExpanded((all) => {
      const next = new Set(all);
      if (!next.delete(id)) next.add(id);
      return next;
    });

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
              {!isSite && (
                <>
                  <span aria-hidden="true">·</span>
                  {shown.period ? t('salesForPeriod') : t('salesAllTime')}
                  <InfoTip text={t('products.hint')} />
                </>
              )}
            </span>
          ) : (
            ' '
          )
        }
      />

      <div className="animate-rise relative z-20 mb-4 flex flex-wrap items-center gap-2">
        {shops && shops.length > 1 && (
          <Segmented
            ariaLabel={t('products.channel')}
            value={channel?.id ?? ''}
            onChange={switchChannel}
            options={shops.map((sh) => ({
              value: sh.id,
              label: (
                <>
                  {sh.displayName || sh.username || ''}
                  <span className="tabular text-xs text-muted">{sh._count?.products ?? ''}</span>
                </>
              ),
            }))}
          />
        )}
        {!isSite && (
          <>
            <span className="mx-1 hidden h-6 w-px bg-line sm:block" aria-hidden="true" />
            <PeriodControl
              value={period}
              onChange={setPeriod}
              labels={labels}
              ariaLabel={tc('period.label')}
            />
          </>
        )}
        <span className="mx-1 hidden h-6 w-px bg-line sm:block" aria-hidden="true" />
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
        {others.length > 0 && (
          <FilterChip
            label={t('products.presence.label')}
            value={presence}
            onChange={setPresence}
            options={[
              ...(!isSite && others.some((o) => o.platform === 'WEBSITE')
                ? [{ value: 'lacksSites', label: t('products.presence.lacksSites') }]
                : []),
              ...others.flatMap((o) => {
                const name = o.platform === 'ETSY' ? 'Etsy' : o.displayName || o.username || '';
                return [
                  { value: `lacks:${o.id}`, label: t('products.presence.lacks', { name }) },
                  { value: `has:${o.id}`, label: t('products.presence.has', { name }) },
                ];
              }),
            ]}
            clearLabel={tc('clearFilter')}
          />
        )}
        <IssuesFilter
          selected={issueCodes}
          onChange={(codes) => {
            setIssueCodes(codes);
            // A pin to a product that is not on sale lives in a non-active state.
            if (codes.length) setState('');
          }}
          counts={issueCounts}
          clearLabel={tc('clearFilter')}
        />
        <span className="xl:hidden">
          <FilterChip
            label={tc('sortBy')}
            value={sort}
            onChange={(v) => setSortChoice(v as Column)}
            options={columns.map((c) => ({ value: c, label: t(`products.columns.${c}`) }))}
            clearable={false}
          />
        </span>
        <label className="ml-auto flex h-9 w-full items-center gap-2 rounded-full border border-line px-3.5 text-sm focus-within:border-[var(--field-focus)] sm:w-72">
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
          <span
            className={`grid gap-6 text-right ${isSite ? 'w-[9rem] grid-cols-1' : 'w-[46rem] grid-cols-6'}`}
          >
            {columns.map((c) => (
              <span key={c} className="flex items-center justify-end gap-1.5">
                <button
                  type="button"
                  onClick={() => setSortChoice(c)}
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
          <span className="w-24" />
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
                className={`transition-colors duration-700 ${p.id === lit ? 'bg-hover' : ''}`}
              >
                <div className="flex flex-wrap items-center gap-x-6 gap-y-3 px-5 py-3 xl:flex-nowrap">
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
                  <dl
                    className={`tabular grid shrink-0 gap-x-6 gap-y-2 text-right ${
                      isSite ? 'grid-cols-1 xl:w-[9rem]' : 'grid-cols-3 sm:grid-cols-6 xl:w-[46rem]'
                    }`}
                  >
                    {columns.map((c) => (
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
                  <span className="flex w-24 shrink-0 items-center justify-end">
                    {p.elsewhere.length > 0 && (
                      <button
                        type="button"
                        onClick={() => toggleExpanded(p.id)}
                        aria-expanded={expanded.has(p.id)}
                        title={t('products.elsewhere')}
                        aria-label={t('products.elsewhere')}
                        className="mr-1 inline-flex h-8 items-center gap-1 rounded-xl px-2 text-xs text-muted hover:bg-hover hover:text-foreground"
                      >
                        <span className="tabular">{p.elsewhere.length}</span>
                        <ChevronDown
                          size={14}
                          aria-hidden="true"
                          className={`transition-transform duration-200 ${expanded.has(p.id) ? 'rotate-180' : ''}`}
                        />
                      </button>
                    )}
                    {p.state !== 'removed' && p.account.platform === 'ETSY' && (
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
                        aria-label={tc('openOnPlatform', {
                          platform:
                            p.account.platform === 'ETSY' ? 'Etsy' : (p.account.username ?? ''),
                        })}
                        title={tc('openOnPlatform', {
                          platform:
                            p.account.platform === 'ETSY' ? 'Etsy' : (p.account.username ?? ''),
                        })}
                      >
                        <ExternalLink size={15} aria-hidden="true" />
                      </a>
                    )}
                  </span>
                </div>
                {expanded.has(p.id) && (
                  <ul className="divide-y divide-line border-t border-line bg-hover py-1 pl-[100px]">
                    {p.elsewhere.map((e) => (
                      <li key={e.id} className="flex items-center gap-3 py-2 pr-5 text-sm">
                        <span className="h-9 w-9 shrink-0 overflow-hidden rounded-lg bg-hover">
                          {e.imageUrl && (
                            // External image: plain <img>, lazy.
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={e.imageUrl}
                              alt=""
                              loading="lazy"
                              className="h-full w-full object-cover"
                            />
                          )}
                        </span>
                        <span className="min-w-0 flex-1">
                          {/* Opens that product's card, on its own channel's list. */}
                          <button
                            type="button"
                            onClick={() => {
                              switchChannel(e.account.id);
                              setOpenId(e.id);
                            }}
                            className="block max-w-full truncate text-left hover:underline hover:underline-offset-2"
                            title={e.title}
                          >
                            {e.title}
                          </button>
                          <span className="text-xs text-muted">
                            {e.account.platform === 'ETSY'
                              ? 'Etsy'
                              : e.account.displayName || e.account.username}
                            {e.state !== 'active' &&
                              ` · ${t(`states.${e.state as (typeof STATES)[number]}`)}`}
                          </span>
                        </span>
                        <span className="tabular shrink-0 text-sm">
                          {money(e.price, e.currency)}
                        </span>
                        {e.url && (
                          <a
                            href={e.url}
                            target="_blank"
                            rel="noreferrer"
                            className="icon-btn h-8 w-8 shrink-0"
                            aria-label={tc('openOnPlatform', {
                              platform:
                                e.account.platform === 'ETSY'
                                  ? 'Etsy'
                                  : (e.account.displayName ?? e.account.username ?? ''),
                            })}
                          >
                            <ExternalLink size={15} aria-hidden="true" />
                          </a>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
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
          ignored={items[openIndex]?.ignored}
          onChanged={() => setVersion((v) => v + 1)}
          onClose={() => setOpenId(null)}
          onPrevious={openIndex > 0 ? () => setOpenId(items[openIndex - 1]!.id) : undefined}
          onNext={
            openIndex >= 0 && openIndex < items.length - 1
              ? () => setOpenId(items[openIndex + 1]!.id)
              : undefined
          }
          onEdit={
            items[openIndex]?.state !== 'removed' && items[openIndex]?.account.platform === 'ETSY'
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
