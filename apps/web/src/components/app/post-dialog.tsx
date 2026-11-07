'use client';

import { ChevronLeft, ChevronRight, ExternalLink, Play, X } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '@/lib/api';
import { InfoTip } from '../ui/info-tip';
import { Segmented } from '../ui/segmented';
import { ImpressionsChart, type SeriesPoint } from './impressions-chart';

type Platform = 'PINTEREST' | 'INSTAGRAM' | 'TIKTOK';
type Detail = {
  id: string;
  url: string | null;
  title: string | null;
  description: string | null;
  thumbnailUrl: string | null;
  contentType: 'IMAGE' | 'VIDEO' | 'CAROUSEL' | 'PRODUCT' | 'OTHER';
  isOwn: boolean;
  publishedAt: string | null;
  board: { id: string; name: string } | null;
  account: { username: string | null; displayName: string | null; platform: Platform };
  asOf: string | null;
  metrics: { key: string; value: number | null; dataStatus: SeriesPoint['status']; date: string }[];
  daily: { from: string; to: string; series: Record<string, Omit<SeriesPoint, 'date'>[]> } | null;
};

/** Display order of post metrics per platform; anything else the platform sends comes after. */
const METRIC_ORDER: Record<Platform, string[]> = {
  PINTEREST: [
    'impressions',
    'saves',
    'pin_clicks',
    'outbound_clicks',
    'reactions',
    'comments',
    'profile_visits',
    'follows',
    'video_views',
    'video_10s_views',
    'video_p95_views',
  ],
  INSTAGRAM: ['views', 'reach', 'likes', 'comments', 'saves', 'shares', 'engagements'],
  TIKTOK: [],
};
/** Metrics with a daily chart (ADR-0013: Pinterest pins only for now). */
const DAILY_METRICS = ['impressions', 'saves', 'pin_clicks', 'outbound_clicks'] as const;
const KNOWN = new Set(Object.values(METRIC_ORDER).flat());
const PLATFORM_NAMES: Record<Platform, string> = {
  PINTEREST: 'Pinterest',
  INSTAGRAM: 'Instagram',
  TIKTOK: 'TikTok',
};

const addDays = (d: string, n: number) =>
  new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/**
 * A post in a glass dialog: large image, full description, every metric the platform reports for
 * it and, where available, its daily dynamics. ←/→ move through the list, Escape closes.
 */
export function PostDialog({
  base,
  postId,
  onClose,
  onPrevious,
  onNext,
}: {
  base: string;
  postId: string;
  onClose: () => void;
  onPrevious?: () => void;
  onNext?: () => void;
}) {
  const t = useTranslations('Post');
  const tContent = useTranslations('Content');
  const format = useFormatter();
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);
  // The loaded post is kept with its id: while the next one loads, the old one is not shown.
  const [loaded, setLoaded] = useState<{ id: string; detail: Detail | null } | null>(null);
  const [chartMetric, setChartMetric] = useState<(typeof DAILY_METRICS)[number]>('impressions');
  const detail = loaded?.id === postId ? loaded.detail : null;
  const failed = loaded?.id === postId && loaded.detail === null;

  useEffect(() => {
    let cancelled = false;
    api<Detail>(`${base}/content/${postId}`).then(
      (d) => !cancelled && setLoaded({ id: postId, detail: d }),
      () => !cancelled && setLoaded({ id: postId, detail: null }),
    );
    return () => {
      cancelled = true;
    };
  }, [base, postId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft') onPrevious?.();
      if (e.key === 'ArrowRight') onNext?.();
    };
    document.addEventListener('keydown', onKey);
    panel.current?.focus();
    // The page behind must not scroll while the dialog is open.
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
    };
  }, [onClose, onPrevious, onNext]);

  const platform = detail?.account.platform ?? 'PINTEREST';
  const order = METRIC_ORDER[platform];
  const metrics = (detail?.metrics ?? [])
    .filter((m) => KNOWN.has(m.key))
    .sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
  const title =
    detail?.title?.trim() ||
    detail?.description?.trim().split('\n')[0] ||
    (detail ? tContent('untitled') : '');
  const description = detail?.description?.trim();
  const showDescription = !!description && description !== detail?.title?.trim();
  const daily = detail?.daily;
  const chartKeys = DAILY_METRICS.filter((k) => daily && k in daily.series);
  const points: SeriesPoint[] | null = daily
    ? (daily.series[chartMetric] ?? []).length
      ? daily.series[chartMetric]!.map((p, i) => ({ date: addDays(daily.from, i), ...p }))
      : // Covered days without any row: no activity at all.
        Array.from(
          {
            length: Math.round((Date.parse(daily.to) - Date.parse(daily.from)) / 86_400_000) + 1,
          },
          (_, i) => ({ date: addDays(daily.from, i), value: 0, status: 'READY' as const }),
        )
    : null;
  const total = points?.reduce((s, p) => s + (p.value ?? 0), 0) ?? 0;
  const dateOf = (iso: string, withYear = true) =>
    format.dateTime(new Date(iso), {
      day: 'numeric',
      month: 'long',
      ...(withYear ? { year: 'numeric' } : {}),
    });

  return createPortal(
    <div className="fixed inset-0 z-[90] flex items-center justify-center p-3 sm:p-6">
      <button
        type="button"
        aria-label={t('close')}
        className="absolute inset-0 bg-black/30 backdrop-blur-sm"
        onClick={onClose}
      />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="glass glass-strong animate-rise relative flex max-h-full w-full max-w-4xl flex-col overflow-hidden rounded-[28px] outline-none"
      >
        {/* Top bar: navigation and close — stays visible while the body scrolls. */}
        <div className="flex items-center gap-1 border-b border-line px-4 py-2.5">
          <span className="flex-1 truncate px-2 text-sm text-muted">
            {detail &&
              [
                PLATFORM_NAMES[platform],
                detail.account.displayName || detail.account.username,
                detail.board?.name,
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

        <div className="overflow-y-auto p-5 sm:p-6">
          {failed && <p className="py-10 text-center text-sm text-muted">{t('failed')}</p>}
          {!detail && !failed && <p className="py-16 text-center text-sm text-muted">…</p>}
          {detail && (
            <>
              <div className="flex flex-col gap-6 md:flex-row">
                {/* Media */}
                <div className="relative shrink-0 self-start overflow-hidden rounded-2xl bg-hover md:w-72">
                  {detail.thumbnailUrl ? (
                    // External platform image.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={detail.thumbnailUrl}
                      alt=""
                      className="max-h-[420px] w-full object-cover"
                    />
                  ) : (
                    <div className="aspect-square w-full" />
                  )}
                  {detail.contentType === 'VIDEO' && (
                    <span className="absolute right-2 bottom-2 flex h-8 w-8 items-center justify-center rounded-full bg-black/60 text-white">
                      <Play size={14} fill="currentColor" aria-hidden="true" />
                    </span>
                  )}
                </div>

                {/* Facts */}
                <div className="min-w-0 flex-1">
                  <h2 id={titleId} className="font-display text-xl leading-snug font-semibold">
                    {title}
                  </h2>
                  <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
                    <span className="rounded-full border border-line px-2 text-xs leading-5">
                      {tContent(`types.${detail.contentType}`)}
                    </span>
                    {!detail.isOwn && (
                      <span className="rounded-full border border-line px-2 text-xs leading-5">
                        {tContent('savedBadge')}
                      </span>
                    )}
                    {detail.publishedAt && (
                      <span>{t('published', { date: dateOf(detail.publishedAt) })}</span>
                    )}
                  </p>
                  {detail.url && (
                    <a
                      href={detail.url}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-4 inline-flex items-center gap-2 rounded-xl border border-line px-3 py-1.5 text-sm hover:bg-hover"
                    >
                      <ExternalLink size={15} aria-hidden="true" />
                      {t('open', { platform: PLATFORM_NAMES[platform] })}
                    </a>
                  )}
                  {showDescription && (
                    <p className="mt-4 max-h-48 overflow-y-auto pr-1 text-sm leading-relaxed whitespace-pre-line text-muted">
                      {description}
                    </p>
                  )}
                </div>
              </div>

              {/* All metrics the platform reports for this post. */}
              <section className="mt-6">
                <h3 className="mb-3 flex items-center gap-1.5 px-1 text-sm font-semibold">
                  {t('metricsTitle')}
                  <InfoTip
                    text={[
                      detail.asOf
                        ? t('metricsHint', { date: dateOf(detail.asOf) })
                        : t('metricsHintNoDate'),
                      platform === 'INSTAGRAM' ? t('instagramNoDaily') : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                  />
                </h3>
                {metrics.length ? (
                  <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                    {metrics.map((m) => (
                      <div key={m.key} className="rounded-2xl bg-hover px-4 py-3">
                        <dt className="flex items-center gap-1 text-xs text-muted">
                          {t(`metrics.${m.key}` as 'metrics.impressions')}
                          {t.has(`hints.${m.key}` as 'hints.reach') && (
                            <InfoTip text={t(`hints.${m.key}` as 'hints.reach')} />
                          )}
                        </dt>
                        <dd className="tabular mt-1 font-display text-xl font-semibold">
                          {m.value === null ? '—' : format.number(m.value)}
                        </dd>
                      </div>
                    ))}
                  </dl>
                ) : (
                  <p className="px-1 text-sm text-muted">{t('noMetrics')}</p>
                )}
              </section>

              {/* Daily dynamics (Pinterest pins, ADR-0013). */}
              {points && chartKeys.length > 0 && daily && (
                <section className="mt-6">
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-3 px-1">
                    <h3 className="flex items-center gap-1.5 text-sm font-semibold">
                      {t('dailyTitle')}
                      <InfoTip
                        text={t('dailyHint', {
                          from: dateOf(daily.from, false),
                          to: dateOf(daily.to, false),
                        })}
                      />
                    </h3>
                    <Segmented
                      value={chartMetric}
                      onChange={setChartMetric}
                      options={DAILY_METRICS.map((k) => ({
                        value: k,
                        label: t(`metrics.${k}`),
                      }))}
                      ariaLabel={t('dailyTitle')}
                    />
                  </div>
                  <p className="mb-2 px-1 text-xs text-muted">
                    {t('dailyTotal', { value: format.number(total) })}
                  </p>
                  <ImpressionsChart
                    points={points}
                    ariaLabel={`${t('dailyTitle')}: ${t(`metrics.${chartMetric}`)}`}
                  />
                </section>
              )}
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
