'use client';

import {
  AlertTriangle,
  Check,
  ChevronLeft,
  ChevronDown,
  CircleAlert,
  ChevronRight,
  ExternalLink,
  EyeOff,
  PenLine,
  Pin,
  X,
} from 'lucide-react';
import { useFormatter, useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { Select } from '../ui/select';
import { InfoTip } from '../ui/info-tip';
import { PanelSheet } from '../ui/panel-sheet';
import { ImpressionsChart, type SeriesPoint } from './impressions-chart';
import { ISSUE_STYLE, sortIssues, type ProductIssue } from './product-issues';
import { minorDigits, useMoney } from './sales-data';

type TwinListing = {
  id: string;
  title: string;
  imageUrl: string | null;
  state: string;
  skus: string[];
};
type Detail = {
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
  tags: string[];
  skus: string[];
  /** Options the SKU goes by ("Color"); empty = one SKU for the whole listing. */
  skuBy: string[];
  /** Listings that are the same product, suggestions (same SKUs) and everything to choose from. */
  twins: TwinListing[];
  twinSuggestions: TwinListing[];
  twinCandidates: { id: string; title: string; state: string }[];
  /** The same article on the other channel: a shop listing's site pages, a site product's listings. */
  elsewhere: {
    id: string;
    title: string;
    url: string | null;
    imageUrl: string | null;
    state: string;
    price: number | null;
    currency: string | null;
    account: { platform: 'ETSY' | 'WEBSITE'; username: string | null; displayName: string | null };
  }[];
  listedAt: string | null;
  account: { username: string | null; displayName: string | null; platform: 'ETSY' | 'WEBSITE' };
  sales: {
    units: number;
    revenue: number;
    orders: number;
    firstSale: string | null;
    lastSale: string | null;
  };
  monthly: { month: string; units: number; revenue: number }[];
  orders: {
    id: string;
    orderedAt: string;
    quantity: number;
    price: number | null;
    currency: string;
    country: string | null;
  }[];
  posts: {
    id: string;
    title: string | null;
    thumbnailUrl: string | null;
    url: string | null;
    publishedAt: string | null;
    account: { platform: 'PINTEREST' | 'INSTAGRAM' };
    latest: {
      impressions: number | null;
      saves: number | null;
      outboundClicks: number | null;
    } | null;
  }[];
};

/**
 * A product in a glass dialog (like the post card): its picture and data, sales all time and by
 * month, latest orders, and the pins leading to it (ADR-0018). ←/→ move through the list.
 */
/**
 * Possible improvements of the product, above its statistics: an accordion, open by default (the
 * chevron in the header says it can be closed). Worst first; a green check when there are none.
 * A problem can be marked "on purpose" (ignored) and brought back from the list below.
 */
function Improvements({
  issues,
  ignored,
  onIgnore,
  onRestore,
}: {
  issues: ProductIssue[];
  ignored: ProductIssue[];
  onIgnore: (code: string) => void;
  onRestore: (code: string) => void;
}) {
  const ti = useTranslations('Sales.issues');
  const [open, setOpen] = useState(true);
  const [showIgnored, setShowIgnored] = useState(false);
  const bodyId = useId();
  const ignoredBlock = ignored.length > 0 && (
    <div className="px-4 pb-4">
      <button
        type="button"
        aria-expanded={showIgnored}
        onClick={() => setShowIgnored((v) => !v)}
        className="flex items-center gap-1.5 text-xs text-muted hover:text-foreground"
      >
        <ChevronDown
          size={13}
          aria-hidden="true"
          className={`transition-transform duration-200 ${showIgnored ? 'rotate-180' : ''}`}
        />
        {ti('ignoredTitle')} · {ignored.length}
      </button>
      {showIgnored && (
        <ul className="mt-2 grid gap-1.5">
          {sortIssues(ignored).map((i) => (
            <li key={i.code} className="flex items-start gap-2 text-sm text-muted">
              <span className="min-w-0 flex-1">{ti(`codes.${i.code}`, i.params)}</span>
              <button
                type="button"
                onClick={() => onRestore(i.code)}
                className="shrink-0 rounded-lg px-2 py-0.5 text-xs hover:bg-hover hover:text-foreground"
              >
                {ti('restore')}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
  if (!issues.length) {
    return (
      <section className="mt-6">
        <p className="flex items-center gap-2 text-sm text-emerald-700 dark:text-emerald-400">
          <Check size={16} strokeWidth={2.25} aria-hidden="true" />
          {ti('none')}
        </p>
        {ignoredBlock && <div className="-mx-4 mt-2">{ignoredBlock}</div>}
      </section>
    );
  }
  return (
    <section className="mt-6 rounded-2xl bg-hover">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 rounded-2xl px-4 py-3 text-left"
      >
        <h3 className="text-sm font-semibold">{ti('title')}</h3>
        <span className="tabular rounded-full bg-hover px-2 text-xs leading-5 text-muted">
          {issues.length}
        </span>
        <ChevronDown
          size={16}
          aria-hidden="true"
          className={`ml-auto shrink-0 text-muted transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open && (
        <>
          <ul id={bodyId} className="grid gap-2 px-4 pb-4">
            {sortIssues(issues).map((i) => (
              <li key={i.code} className="flex items-start gap-2 text-sm">
                <CircleAlert
                  size={16}
                  className={`mt-0.5 shrink-0 ${ISSUE_STYLE[i.level].text}`}
                  aria-hidden="true"
                />
                <span className="min-w-0 flex-1">
                  {ti(`codes.${i.code}`, i.params)}{' '}
                  <span className="text-xs text-muted">({ti(`levels.${i.level}`)})</span>
                </span>
                <button
                  type="button"
                  onClick={() => onIgnore(i.code)}
                  title={ti('ignoreHint')}
                  className="inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-0.5 text-xs text-muted hover:bg-hover hover:text-foreground"
                >
                  <EyeOff size={13} aria-hidden="true" />
                  {ti('ignore')}
                </button>
              </li>
            ))}
          </ul>
          {ignoredBlock}
        </>
      )}
    </section>
  );
}

/**
 * The same article on the other channel (ADR-0021): a shop listing's pages on the site (with the
 * site's price), a site product's Etsy listings. Hidden when there is none — a problem says so.
 */
function Elsewhere({ detail }: { detail: Detail }) {
  const t = useTranslations('Sales.card');
  const money = useMoney();
  if (!detail.elsewhere.length) return null;
  const channel = (c: Detail['elsewhere'][number]) =>
    c.account.platform === 'ETSY' ? 'Etsy' : c.account.displayName || c.account.username || '';
  return (
    <section className="mt-6">
      <p className="mb-2 flex items-center gap-1.5 px-1 text-xs text-muted">
        {t(detail.account.platform === 'ETSY' ? 'onSite' : 'onEtsy', {
          count: detail.elsewhere.length,
        })}
        <InfoTip text={t('elsewhereHint')} />
      </p>
      <ul className="divide-y divide-line rounded-2xl border border-line">
        {detail.elsewhere.map((c) => (
          <li key={c.id} className="flex items-center gap-2.5 px-3 py-2 text-sm">
            <span className="h-8 w-8 shrink-0 overflow-hidden rounded-lg bg-hover">
              {c.imageUrl && (
                // External image: plain <img>, lazy.
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={c.imageUrl}
                  alt=""
                  loading="lazy"
                  className="h-full w-full object-cover"
                />
              )}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate">{c.title}</span>
              <span className="text-xs text-muted">
                {channel(c)} · {money(c.price, c.currency)}
              </span>
            </span>
            {c.url && (
              <a
                href={c.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-line px-2.5 py-1 text-xs hover:bg-hover"
              >
                <ExternalLink size={13} aria-hidden="true" />
                {t('open')}
              </a>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Twins (ADR-0021): listings that are the same product — the same variations, only their order or
 * photos differ. They are not duplicates of each other's SKU, but must agree on SKUs and price.
 */
function Twins({
  detail,
  base,
  productId,
  onChanged,
}: {
  detail: Detail;
  base: string;
  productId: string;
  onChanged: () => void;
}) {
  const t = useTranslations('Sales.card');
  const ts = useTranslations('Sales');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const act = async (path: string, method: 'PUT' | 'DELETE', json?: unknown) => {
    setBusy(true);
    setFailed(false);
    try {
      await api(`${base}/products/${path}`, { method, json });
      onChanged();
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };
  const link = (id: string) => act(`${productId}/twin`, 'PUT', { twinProductId: id });
  const taken = new Set([productId, ...detail.twins.map((x) => x.id)]);
  const row = (c: TwinListing, action: React.ReactNode) => (
    <li key={c.id} className="flex items-center gap-2.5 px-3 py-2 text-sm">
      <span className="h-8 w-8 shrink-0 overflow-hidden rounded-lg bg-hover">
        {c.imageUrl && (
          // External platform image: plain <img>, lazy.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={c.imageUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate">{c.title}</span>
        <span className="tabular text-xs text-muted">
          {c.state !== 'active' && `${ts(`states.${c.state as 'active'}`)} · `}
          {c.skus.join(', ') || '—'}
        </span>
      </span>
      {action}
    </li>
  );
  const button = 'shrink-0 rounded-lg border border-line px-2.5 py-1 text-xs hover:bg-hover';
  return (
    <div className="mt-6">
      <p className="mb-2 flex items-center gap-1.5 text-xs text-muted">
        {t('twins', { count: detail.twins.length })}
        <InfoTip text={t('twinsHint')} />
      </p>
      {detail.twins.length > 0 && (
        <ul className="mb-2 divide-y divide-line rounded-2xl border border-line">
          {detail.twins.map((c) =>
            row(
              c,
              <button
                type="button"
                disabled={busy}
                onClick={() => act(`${c.id}/twin`, 'DELETE')}
                className={button}
              >
                {t('twinUnlink')}
              </button>,
            ),
          )}
        </ul>
      )}
      {detail.twinSuggestions.length > 0 && (
        <div className="mb-2">
          <p className="mb-1 px-1 text-xs text-muted">{t('twinSuggested')}</p>
          <ul className="divide-y divide-line rounded-2xl border border-dashed border-line">
            {detail.twinSuggestions.map((c) =>
              row(
                c,
                <button type="button" disabled={busy} onClick={() => link(c.id)} className={button}>
                  {t('twinLink')}
                </button>,
              ),
            )}
          </ul>
        </div>
      )}
      <div className="max-w-sm">
        <Select
          value=""
          onChange={(id) => id && link(id)}
          options={detail.twinCandidates
            .filter((c) => !taken.has(c.id))
            .map((c) => ({
              value: c.id,
              label: c.title,
              hint: c.state !== 'active' ? ts(`states.${c.state as 'active'}`) : undefined,
            }))}
          placeholder={t('twinAdd')}
          searchable
          searchPlaceholder={t('twinSearch')}
          ariaLabel={t('twinAdd')}
          disabled={busy}
        />
      </div>
      {failed && (
        <p className="mt-1 px-1 text-xs text-rose-600 dark:text-rose-400">{t('twinFailed')}</p>
      )}
    </div>
  );
}

export function ProductDialog({
  base,
  productId,
  issues,
  ignored,
  onChanged,
  onClose,
  onPrevious,
  onNext,
  onEdit,
}: {
  base: string;
  productId: string;
  /** Problems of the product (from the list); the block is hidden when absent. */
  issues?: ProductIssue[];
  /** Problems marked "on purpose" for this product. */
  ignored?: ProductIssue[];
  /** The product's problems or twins changed: the list reloads. */
  onChanged?: () => void;
  onClose: () => void;
  onPrevious?: () => void;
  onNext?: () => void;
  /** Absent for products that cannot be edited (e.g. removed from the shop). */
  onEdit?: () => void;
}) {
  const t = useTranslations('Sales.card');
  const ts = useTranslations('Sales');
  const format = useFormatter();
  const locale = useLocale();
  const money = useMoney();
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);
  const [loaded, setLoaded] = useState<{ id: string; detail: Detail | null } | null>(null);
  const detail = loaded?.id === productId ? loaded.detail : null;
  const failed = loaded?.id === productId && loaded.detail === null;
  /** Bumped after a change (twins), to read the card again. */
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    api<Detail>(`${base}/products/${productId}`).then(
      (d) => !cancelled && setLoaded({ id: productId, detail: d }),
      () => !cancelled && setLoaded({ id: productId, detail: null }),
    );
    return () => {
      cancelled = true;
    };
  }, [base, productId, reloadKey]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft') onPrevious?.();
      if (e.key === 'ArrowRight') onNext?.();
    };
    document.addEventListener('keydown', onKey);
    panel.current?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose, onPrevious, onNext]);

  const currency = detail?.currency ?? detail?.orders[0]?.currency ?? null;
  const points: SeriesPoint[] = useMemo(
    () =>
      (detail?.monthly ?? []).map((m) => ({
        date: m.month,
        value: currency ? m.revenue / 10 ** minorDigits(currency) : m.revenue,
        status: 'READY',
      })),
    [detail, currency],
  );
  const regions = useMemo(() => new Intl.DisplayNames([locale], { type: 'region' }), [locale]);
  const country = (code: string | null) => {
    if (!code) return '—';
    try {
      return regions.of(code) ?? code;
    } catch {
      return code;
    }
  };
  const date = (iso: string) =>
    format.dateTime(new Date(iso), { day: 'numeric', month: 'short', year: 'numeric' });
  const count = (v: number | null) => (v === null ? '—' : format.number(v));

  // A site's feed gives a price and nothing else: no sales or views are known, so no tiles for
  // them (a 0 would be a claim we cannot make).
  const isSite = detail?.account.platform === 'WEBSITE';
  const stats: { id: string; value: string; hint?: string }[] = detail
    ? [
        { id: 'price', value: money(detail.price, detail.currency) },
        { id: 'quantity', value: count(detail.quantity) },
        { id: 'views', value: count(detail.views), hint: ts('products.hints.views') },
        { id: 'favorers', value: count(detail.favorers), hint: ts('products.hints.favorers') },
        { id: 'sold', value: format.number(detail.sales.units), hint: t('soldHint') },
        {
          id: 'revenue',
          value: detail.sales.revenue ? money(detail.sales.revenue, currency) : '—',
          hint: t('revenueHint'),
        },
      ].filter((s) => !isSite || s.id === 'price')
    : [];

  return (
    <PanelSheet labelledBy={titleId} panelRef={panel} onClose={onClose} closeLabel={t('close')}>
      <div className="flex items-center gap-1 border-b border-line px-4 py-2.5">
        <span className="flex-1 truncate px-2 text-sm text-muted">
          {detail &&
            [
              detail.account.platform === 'ETSY' ? 'Etsy' : ts('shopKind.WEBSITE'),
              detail.account.displayName || detail.account.username,
            ]
              .filter(Boolean)
              .join(' · ')}
        </span>
        <button
          type="button"
          onClick={onPrevious}
          disabled={!onPrevious}
          aria-label={t('previous')}
          title={t('previous')}
          className="icon-btn h-9 w-9 disabled:opacity-30"
        >
          <ChevronLeft size={18} aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={onNext}
          disabled={!onNext}
          aria-label={t('next')}
          title={t('next')}
          className="icon-btn h-9 w-9 disabled:opacity-30"
        >
          <ChevronRight size={18} aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={onClose}
          aria-label={t('close')}
          className="icon-btn h-9 w-9"
        >
          <X size={18} aria-hidden="true" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-5 sm:p-8">
        <div className="mx-auto w-full max-w-5xl">
          {failed && <p className="py-10 text-center text-sm text-muted">{t('failed')}</p>}
          {!detail && !failed && <p className="py-16 text-center text-sm text-muted">…</p>}
          {detail && (
            <>
              <div className="flex flex-col gap-6 md:flex-row">
                <div className="shrink-0 self-start overflow-hidden rounded-2xl bg-hover md:w-72">
                  {detail.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={detail.imageUrl}
                      alt=""
                      className="max-h-[420px] w-full object-cover"
                    />
                  ) : (
                    <div className="aspect-square w-full" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <h2 id={titleId} className="text-xl leading-snug font-semibold">
                    {detail.title}
                  </h2>
                  <p className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted">
                    {detail.state !== 'active' && (
                      <span className="rounded-full border border-line px-2 text-xs leading-5">
                        {ts(`states.${detail.state as 'active'}`)}
                      </span>
                    )}
                    {detail.listedAt && ts('products.listed', { date: date(detail.listedAt) })}
                    {detail.sales.lastSale && (
                      <>
                        <span aria-hidden="true">·</span>
                        {t('lastSale', { date: date(detail.sales.lastSale) })}
                      </>
                    )}
                  </p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    {detail.url && (
                      <a
                        href={detail.url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-2 rounded-xl border border-line px-3 py-1.5 text-sm hover:bg-hover"
                      >
                        <ExternalLink size={15} aria-hidden="true" />
                        {detail.account.platform === 'ETSY' ? t('openOnEtsy') : t('openOnSite')}
                      </a>
                    )}
                    {onEdit && (
                      <button
                        type="button"
                        onClick={onEdit}
                        className="inline-flex items-center gap-2 rounded-xl border border-line px-3 py-1.5 text-sm hover:bg-hover"
                      >
                        <PenLine size={15} aria-hidden="true" />
                        {ts('products.edit')}
                      </button>
                    )}
                  </div>

                  {/* SKUs: what links the product to the same one on the website (ADR-0021). */}
                  <div className="mt-5">
                    <p className="mb-2 flex items-center gap-1.5 text-xs text-muted">
                      {t('sku', { count: detail.skus.length })}
                      <InfoTip text={t('skuHint')} />
                    </p>
                    {detail.skuBy.length > 0 && (
                      <p className="mb-2 text-xs text-muted">
                        {t('skuBy', { options: detail.skuBy.join(', ') })}
                      </p>
                    )}
                    {detail.skus.length ? (
                      <div className="flex flex-wrap gap-1.5">
                        {detail.skus.map((sku) => (
                          <span
                            key={sku}
                            className="tabular rounded-full bg-hover px-2 py-0.5 text-xs"
                          >
                            {sku}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <p className="flex items-center gap-1.5 text-sm text-amber-700 dark:text-amber-400">
                        <AlertTriangle size={14} aria-hidden="true" />
                        {t('noSku')}
                      </p>
                    )}
                  </div>

                  {/* Tags: what Etsy search finds the product by. */}
                  <div className="mt-5">
                    <p className="mb-2 flex items-center gap-1.5 text-xs text-muted">
                      {t('tags', { count: detail.tags.length })}
                      <InfoTip text={t('tagsHint')} />
                    </p>
                    {detail.tags.length ? (
                      <div className="flex flex-wrap gap-1.5">
                        {detail.tags.map((tag) => (
                          <span key={tag} className="rounded-full bg-hover px-2 py-0.5 text-xs">
                            {tag}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <p className="flex items-center gap-1.5 text-sm text-amber-700 dark:text-amber-400">
                        <AlertTriangle size={14} aria-hidden="true" />
                        {t('noTags')}
                      </p>
                    )}
                  </div>
                </div>
              </div>

              {issues && (
                <Improvements
                  issues={issues}
                  ignored={ignored ?? []}
                  onIgnore={(code) =>
                    api(`${base}/products/${productId}/issues/${code}/ignore`, {
                      method: 'PUT',
                    }).then(() => onChanged?.())
                  }
                  onRestore={(code) =>
                    api(`${base}/products/${productId}/issues/${code}/ignore`, {
                      method: 'DELETE',
                    }).then(() => onChanged?.())
                  }
                />
              )}

              {detail.account.platform === 'ETSY' && (
                <Twins
                  detail={detail}
                  base={base}
                  productId={productId}
                  onChanged={() => {
                    setReloadKey((k) => k + 1);
                    onChanged?.();
                  }}
                />
              )}

              <Elsewhere detail={detail} />

              <dl className="mt-6 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
                {stats.map((s) => (
                  <div key={s.id} className="rounded-2xl bg-hover px-4 py-3">
                    <dt className="flex items-center gap-1 text-xs text-muted">
                      {ts(`products.columns.${s.id as 'price'}`)}
                      {s.hint && <InfoTip text={s.hint} />}
                    </dt>
                    <dd className="tabular mt-1 font-display text-xl font-semibold">{s.value}</dd>
                  </div>
                ))}
              </dl>

              {!isSite && (
                <section className="mt-6">
                  <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2 px-1">
                    <h3 className="text-sm font-semibold">{t('monthly')}</h3>
                    <p className="text-xs text-muted">
                      {t('ordersTotal', { count: detail.sales.orders })}
                      {detail.sales.firstSale &&
                        ` · ${t('since', { date: date(detail.sales.firstSale) })}`}
                    </p>
                  </div>
                  <ImpressionsChart
                    points={points}
                    ariaLabel={t('monthly')}
                    formatValue={(v) =>
                      currency
                        ? money(Math.round(v * 10 ** minorDigits(currency)), currency)
                        : String(v)
                    }
                  />
                </section>
              )}

              <div className="mt-6 grid gap-6 md:grid-cols-2">
                {!isSite && (
                  <section>
                    <h3 className="mb-2 px-1 text-sm font-semibold">{t('latestOrders')}</h3>
                    {detail.orders.length ? (
                      <ul className="divide-y divide-line rounded-2xl border border-line">
                        {detail.orders.map((o) => (
                          <li key={o.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                            <span className="tabular w-32 shrink-0 whitespace-nowrap text-muted">
                              {date(o.orderedAt)}
                            </span>
                            <span className="flex-1 truncate">{country(o.country)}</span>
                            <span className="text-xs text-muted">×{o.quantity}</span>
                            <span className="tabular w-24 shrink-0 text-right whitespace-nowrap">
                              {money(o.price === null ? null : o.price * o.quantity, o.currency)}
                            </span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="px-1 text-sm text-muted">{t('noOrders')}</p>
                    )}
                  </section>
                )}

                <section>
                  <h3 className="mb-2 flex items-center gap-1.5 px-1 text-sm font-semibold">
                    {t('pins')}
                    <InfoTip text={t('pinsHint')} />
                  </h3>
                  {detail.posts.length ? (
                    <ul className="divide-y divide-line rounded-2xl border border-line">
                      {detail.posts.map((p) => (
                        <li key={p.id} className="flex items-center gap-2 pr-3 hover:bg-hover">
                          {/* The post's card in Adelie (Content), in a new tab. */}
                          <Link
                            href={`/content?platform=${p.account.platform}&post=${p.id}`}
                            target="_blank"
                            className="flex min-w-0 flex-1 items-center gap-3 px-3 py-2 text-sm"
                          >
                            <span className="h-10 w-10 shrink-0 overflow-hidden rounded-lg bg-hover">
                              {p.thumbnailUrl && (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                  src={p.thumbnailUrl}
                                  alt=""
                                  className="h-full w-full object-cover"
                                />
                              )}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate">
                                {p.title?.trim() || t('untitledPin')}
                              </span>
                              <span className="text-xs text-muted">
                                {t('pinStats', {
                                  impressions: count(p.latest?.impressions ?? null),
                                  clicks: count(p.latest?.outboundClicks ?? null),
                                })}
                              </span>
                            </span>
                          </Link>
                          {p.url && (
                            <a
                              href={p.url}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-line px-2.5 py-1 text-xs hover:bg-hover"
                            >
                              <ExternalLink size={13} aria-hidden="true" />
                              {t('viewOn', {
                                platform:
                                  p.account.platform === 'INSTAGRAM' ? 'Instagram' : 'Pinterest',
                              })}
                            </a>
                          )}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="flex items-center gap-1.5 px-1 text-sm text-muted">
                      <Pin size={14} aria-hidden="true" />
                      {t('noPins')}
                    </p>
                  )}
                </section>
              </div>
            </>
          )}
        </div>
      </div>
    </PanelSheet>
  );
}
