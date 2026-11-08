'use client';

import { ChevronLeft, ChevronRight, ExternalLink, X } from 'lucide-react';
import { useFormatter, useLocale, useTranslations } from 'next-intl';
import { Fragment, useEffect, useId, useMemo, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { InfoTip } from '../ui/info-tip';
import { PanelSheet } from '../ui/panel-sheet';
import { useMoney } from './sales-data';

type Detail = {
  id: string;
  number: string;
  orderedAt: string;
  status: string | null;
  isPaid: boolean | null;
  isShipped: boolean | null;
  currency: string;
  total: number | null;
  subtotal: number | null;
  shipping: number | null;
  tax: number | null;
  discount: number | null;
  revenue: number | null;
  country: string | null;
  /** The order in the seller's Etsy dashboard. */
  sellerUrl: string | null;
  account: { username: string | null; displayName: string | null };
  items: {
    id: string;
    title: string | null;
    quantity: number;
    price: number | null;
    product: {
      id: string;
      title: string;
      imageUrl: string | null;
      url: string | null;
      state: string;
    } | null;
  }[];
  ledger: { id: string; type: string; category: string; amount: number; currency: string }[];
  net: number | null;
};

/** Ledger categories in the order of the card. */
const CATEGORIES = [
  'sales',
  'tax',
  'refund',
  'transaction_fee',
  'processing_fee',
  'listing_fee',
  'vat',
  'ads',
  'other',
] as const;

/**
 * An order in full (panel-sized sheet, like the product card): its lines, what the buyer paid,
 * and what stayed with the shop from the Etsy ledger. ←/→ move through the list.
 */
export function OrderDialog({
  base,
  orderId,
  onClose,
  onPrevious,
  onNext,
}: {
  base: string;
  orderId: string;
  onClose: () => void;
  onPrevious?: () => void;
  onNext?: () => void;
}) {
  const t = useTranslations('Sales.orderCard');
  const ts = useTranslations('Sales');
  const format = useFormatter();
  const locale = useLocale();
  const money = useMoney();
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);
  const [loaded, setLoaded] = useState<{ id: string; detail: Detail | null } | null>(null);
  const detail = loaded?.id === orderId ? loaded.detail : null;
  const failed = loaded?.id === orderId && loaded.detail === null;

  useEffect(() => {
    let cancelled = false;
    api<Detail>(`${base}/orders/${orderId}`).then(
      (d) => !cancelled && setLoaded({ id: orderId, detail: d }),
      () => !cancelled && setLoaded({ id: orderId, detail: null }),
    );
    return () => {
      cancelled = true;
    };
  }, [base, orderId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft') onPrevious?.();
      if (e.key === 'ArrowRight') onNext?.();
    };
    document.addEventListener('keydown', onKey);
    panel.current?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, onPrevious, onNext]);

  const country = useMemo(() => {
    const names = new Intl.DisplayNames([locale], { type: 'region' });
    return (code: string | null) => {
      if (!code) return '—';
      try {
        return names.of(code) ?? code;
      } catch {
        return code;
      }
    };
  }, [locale]);
  const byCategory = useMemo(() => {
    const sums = new Map<string, number>();
    for (const e of detail?.ledger ?? [])
      sums.set(e.category, (sums.get(e.category) ?? 0) + e.amount);
    return CATEGORIES.filter((c) => sums.has(c)).map((c) => ({
      category: c,
      amount: sums.get(c)!,
    }));
  }, [detail]);

  const cur = detail?.currency ?? 'USD';
  const row = (
    label: string,
    value: number | null,
    opts: { strong?: boolean; hint?: string } = {},
  ) => (
    <li className={`flex items-center gap-2 px-1 ${opts.strong ? 'font-semibold' : ''}`}>
      <span className="flex flex-1 items-center gap-1.5">
        {label}
        {opts.hint && <InfoTip text={opts.hint} />}
      </span>
      <span className="tabular">{money(value, cur)}</span>
    </li>
  );

  return (
    <PanelSheet labelledBy={titleId} panelRef={panel} onClose={onClose} closeLabel={t('close')}>
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
              <h2 id={titleId} className="text-xl font-semibold">
                {t('title', { number: detail.number })}
              </h2>
              <p className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted">
                {format.dateTime(new Date(detail.orderedAt), {
                  dateStyle: 'long',
                  timeStyle: 'short',
                })}
                <span aria-hidden="true">·</span>
                {country(detail.country)}
                {detail.isPaid && (
                  <span className="rounded-full bg-hover px-2 text-xs leading-5 text-foreground">
                    {t('paid')}
                  </span>
                )}
                {detail.isShipped && (
                  <span className="rounded-full bg-hover px-2 text-xs leading-5 text-foreground">
                    {t('shipped')}
                  </span>
                )}
                {detail.status && (
                  <span className="rounded-full border border-line px-2 text-xs leading-5">
                    {detail.status}
                  </span>
                )}
              </p>
              {detail.sellerUrl && (
                <a
                  href={detail.sellerUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-4 inline-flex items-center gap-2 rounded-xl border border-line px-3 py-1.5 text-sm hover:bg-hover"
                >
                  <ExternalLink size={15} aria-hidden="true" />
                  {t('openInEtsy')}
                </a>
              )}

              <section className="mt-6">
                <h3 className="mb-2 px-1 text-sm font-semibold">
                  {t('items', { count: detail.items.length })}
                </h3>
                <ul className="divide-y divide-line rounded-2xl border border-line">
                  {detail.items.map((i) => {
                    const title = i.title ?? i.product?.title ?? ts('orders.noTitle');
                    return (
                      <li key={i.id} className="flex items-center gap-3 px-3 py-2.5 text-sm">
                        <span className="h-14 w-14 shrink-0 overflow-hidden rounded-xl bg-hover">
                          {i.product?.imageUrl && (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={i.product.imageUrl}
                              alt=""
                              className="h-full w-full object-cover"
                            />
                          )}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium" title={title}>
                            {title}
                          </span>
                          {i.product && i.product.state !== 'active' && (
                            <span className="text-xs text-muted">
                              {ts(`states.${i.product.state as 'active'}`)}
                            </span>
                          )}
                        </span>
                        <span className="tabular shrink-0 text-xs whitespace-nowrap text-muted">
                          {i.quantity} × {money(i.price, cur)}
                        </span>
                        <span className="tabular w-28 shrink-0 text-right whitespace-nowrap">
                          {money(i.price === null ? null : i.price * i.quantity, cur)}
                        </span>
                        <span className="w-8 shrink-0">
                          {i.product?.url && (
                            <a
                              href={i.product.url}
                              target="_blank"
                              rel="noreferrer"
                              className="icon-btn h-8 w-8"
                              aria-label={t('openListing')}
                              title={t('openListing')}
                            >
                              <ExternalLink size={15} aria-hidden="true" />
                            </a>
                          )}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </section>

              <div className="mt-6 grid gap-4 md:grid-cols-2">
                <section className="rounded-2xl bg-hover p-5">
                  <h3 className="mb-3 px-1 text-sm font-semibold">{t('paidTitle')}</h3>
                  <ul className="space-y-2 text-sm">
                    {row(t('subtotal'), detail.subtotal)}
                    {!!detail.discount && row(t('discount'), -detail.discount)}
                    {row(t('shipping'), detail.shipping)}
                    {row(t('tax'), detail.tax, { hint: t('taxHint') })}
                  </ul>
                  <div className="mt-3 border-t border-line pt-3 text-sm">
                    <ul>{row(t('total'), detail.total, { strong: true })}</ul>
                  </div>
                </section>

                <section className="rounded-2xl bg-hover p-5">
                  <h3 className="mb-3 flex items-center gap-1.5 px-1 text-sm font-semibold">
                    {t('keptTitle')}
                    <InfoTip text={t('keptHint')} />
                  </h3>
                  {byCategory.length ? (
                    <ul className="space-y-2 text-sm">
                      {byCategory.map((c) => (
                        <Fragment key={c.category}>
                          {row(t(`ledger.${c.category}`), c.amount)}
                        </Fragment>
                      ))}
                    </ul>
                  ) : (
                    <p className="px-1 text-sm text-muted">{t('noLedger')}</p>
                  )}
                  <div className="mt-3 border-t border-line pt-3 text-sm">
                    {detail.net !== null ? (
                      <ul>{row(t('net'), detail.net, { strong: true })}</ul>
                    ) : (
                      <p className="px-1 text-xs text-muted">{t('noPayment')}</p>
                    )}
                  </div>
                </section>
              </div>
            </>
          )}
        </div>
      </div>
    </PanelSheet>
  );
}
