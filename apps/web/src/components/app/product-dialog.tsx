'use client';

import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  PenLine,
  Pin,
  X,
} from 'lucide-react';
import { useFormatter, useLocale, useTranslations } from 'next-intl';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { InfoTip } from '../ui/info-tip';
import { PanelSheet } from '../ui/panel-sheet';
import { ImpressionsChart, type SeriesPoint } from './impressions-chart';
import { minorDigits, useMoney } from './sales-data';

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
  listedAt: string | null;
  account: { username: string | null; displayName: string | null; platform: 'ETSY' };
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
export function ProductDialog({
  base,
  productId,
  onClose,
  onPrevious,
  onNext,
  onEdit,
}: {
  base: string;
  productId: string;
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

  useEffect(() => {
    let cancelled = false;
    api<Detail>(`${base}/products/${productId}`).then(
      (d) => !cancelled && setLoaded({ id: productId, detail: d }),
      () => !cancelled && setLoaded({ id: productId, detail: null }),
    );
    return () => {
      cancelled = true;
    };
  }, [base, productId]);

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
      ]
    : [];

  return (
    <PanelSheet labelledBy={titleId} panelRef={panel}>
      <div className="flex items-center gap-1 border-b border-line px-4 py-2.5">
        <span className="flex-1 truncate px-2 text-sm text-muted">
          {detail &&
            ['Etsy', detail.account.displayName || detail.account.username]
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
                        {t('openOnEtsy')}
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

              <div className="mt-6 grid gap-6 md:grid-cols-2">
                <section>
                  <h3 className="mb-2 px-1 text-sm font-semibold">{t('latestOrders')}</h3>
                  {detail.orders.length ? (
                    <ul className="divide-y divide-line rounded-2xl border border-line">
                      {detail.orders.map((o) => (
                        <li key={o.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                          <span className="tabular w-24 shrink-0 text-muted">
                            {date(o.orderedAt)}
                          </span>
                          <span className="flex-1 truncate">{country(o.country)}</span>
                          <span className="text-xs text-muted">×{o.quantity}</span>
                          <span className="tabular w-20 text-right">
                            {money(o.price === null ? null : o.price * o.quantity, o.currency)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="px-1 text-sm text-muted">{t('noOrders')}</p>
                  )}
                </section>

                <section>
                  <h3 className="mb-2 flex items-center gap-1.5 px-1 text-sm font-semibold">
                    {t('pins')}
                    <InfoTip text={t('pinsHint')} />
                  </h3>
                  {detail.posts.length ? (
                    <ul className="divide-y divide-line rounded-2xl border border-line">
                      {detail.posts.map((p) => (
                        <li key={p.id}>
                          <a
                            href={p.url ?? undefined}
                            target="_blank"
                            rel="noreferrer"
                            className="flex items-center gap-3 px-3 py-2 text-sm hover:bg-hover"
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
                          </a>
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
