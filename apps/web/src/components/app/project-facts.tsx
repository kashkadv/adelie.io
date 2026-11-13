'use client';

import { useFormatter, useLocale, useTranslations } from 'next-intl';
import { useEffect, useState, type ReactNode } from 'react';
import { api } from '@/lib/api';
import { InfoTip } from '../ui/info-tip';
import { PlatformIcon, type PlatformKey } from '../ui/platform-icon';

interface Facts {
  pinterest: {
    name: string;
    followers: number | null;
    pins: number;
    pinsToSite: number;
    pinsToEtsy: number;
    last30: { impressions: number; saves: number; outboundClicks: number };
    top: { title: string; impressions: number; outboundClicks: number }[];
  }[];
  instagram: {
    name: string;
    followers: number | null;
    posts: number;
    last30: { reach: number; views: number; likes: number; saves: number; linkTaps: number };
    top: { title: string; reach: number; saves: number }[];
  }[];
  tiktok: { name: string; followers: number | null; videos: number | null }[];
  etsy: {
    name: string;
    activeListings: number;
    withoutTags: number;
    orders12m: number;
    revenue12m: number;
    currency: string | null;
    avgOrder: number | null;
    countries: { code: string; share: number }[];
    topProducts: { title: string; sold: number }[];
    reviews: number | null;
    favorers: number | null;
  }[];
  sites: {
    name: string;
    products: number;
    categories: { name: string; count: number }[];
    flipper: {
      visits30: number;
      visitors30: number;
      channels: { name: string; visits: number }[];
    } | null;
  }[];
  links: number;
}

/**
 * What Adelie already knows about the project (ADR-0031), counted from its connections: audience,
 * content, sales, site traffic. Read-only; the AI gets the same with every request.
 */
export function ProjectFacts({ base }: { base: string }) {
  const t = useTranslations('Calendar.facts');
  const format = useFormatter();
  const locale = useLocale();
  const [facts, setFacts] = useState<Facts | null>(null);

  useEffect(() => {
    let cancelled = false;
    api<Facts>(`${base}/facts`).then(
      (f) => !cancelled && setFacts(f),
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [base]);

  if (!facts) return null;
  const n = (v: number | null | undefined) =>
    v === null || v === undefined ? '—' : format.number(v);
  const money = (v: number | null, currency: string | null) =>
    v === null
      ? '—'
      : currency
        ? format.number(v, { style: 'currency', currency, maximumFractionDigits: 0 })
        : format.number(v);
  const country = (code: string) => {
    try {
      return new Intl.DisplayNames([locale], { type: 'region' }).of(code) ?? code;
    } catch {
      return code;
    }
  };

  const card = (
    platform: PlatformKey,
    name: string,
    rows: [string, ReactNode][],
    extra?: ReactNode,
  ) => (
    <div key={`${platform}${name}`} className="rounded-2xl border border-line p-4 text-sm">
      <p className="mb-2 flex items-center gap-2 font-medium">
        <PlatformIcon platform={platform} size={15} strokeWidth={1.75} />
        <span className="truncate">{name}</span>
      </p>
      <dl className="grid gap-1">
        {rows.map(([label, value]) => (
          <div key={label} className="flex justify-between gap-3">
            <dt className="text-muted">{label}</dt>
            <dd className="tabular text-right">{value}</dd>
          </div>
        ))}
      </dl>
      {extra}
    </div>
  );
  const list = (title: string, items: string[]) =>
    items.length > 0 && (
      <div className="mt-2 border-t border-line pt-2">
        <p className="mb-1 text-xs text-muted">{title}</p>
        <ul className="grid gap-0.5 text-xs">
          {items.map((line, i) => (
            <li key={i} className="truncate" title={line}>
              {line}
            </li>
          ))}
        </ul>
      </div>
    );

  const cards = [
    ...facts.etsy.map((e) =>
      card(
        'ETSY',
        e.name,
        [
          [t('activeListings'), n(e.activeListings)],
          [t('withoutTags'), n(e.withoutTags)],
          [t('orders12m'), n(e.orders12m)],
          [t('revenue12m'), money(e.revenue12m, e.currency)],
          [t('avgOrder'), money(e.avgOrder, e.currency)],
          [t('reviews'), n(e.reviews)],
          [t('favorers'), n(e.favorers)],
        ],
        <>
          {list(
            t('countries'),
            [e.countries.map((c) => `${country(c.code)} ${c.share}%`).join(' · ')].filter(Boolean),
          )}
          {list(
            t('topProducts'),
            e.topProducts.map((p) => `${p.sold} × ${p.title}`),
          )}
        </>,
      ),
    ),
    ...facts.sites.map((s) =>
      card(
        'WEBSITE',
        s.name,
        [
          [t('products'), n(s.products)],
          ...(s.flipper
            ? ([
                [t('visits30'), n(s.flipper.visits30)],
                [t('visitors30'), n(s.flipper.visitors30)],
              ] as [string, ReactNode][])
            : ([[t('flipper'), t('notTracked')]] as [string, ReactNode][])),
        ],
        <>
          {s.flipper &&
            list(
              t('channels'),
              [
                s.flipper.channels.map((c) => `${c.name} ${format.number(c.visits)}`).join(' · '),
              ].filter(Boolean),
            )}
          {list(
            t('categories'),
            [s.categories.map((c) => `${c.name} ${c.count}`).join(' · ')].filter(Boolean),
          )}
        </>,
      ),
    ),
    ...facts.instagram.map((i) =>
      card(
        'INSTAGRAM',
        i.name,
        [
          [t('followers'), n(i.followers)],
          [t('posts'), n(i.posts)],
          [t('reach30'), n(i.last30.reach)],
          [t('likes30'), n(i.last30.likes)],
          [t('saves30'), n(i.last30.saves)],
          [t('linkTaps30'), n(i.last30.linkTaps)],
        ],
        list(
          t('topPosts'),
          i.top.map((p) => `${format.number(p.reach)} · ${p.title}`),
        ),
      ),
    ),
    ...facts.pinterest.map((p) =>
      card(
        'PINTEREST',
        p.name,
        [
          [t('followers'), n(p.followers)],
          [t('pins'), n(p.pins)],
          [t('pinsToSite'), n(p.pinsToSite)],
          [t('pinsToEtsy'), n(p.pinsToEtsy)],
          [t('impressions30'), n(p.last30.impressions)],
          [t('saves30'), n(p.last30.saves)],
          [t('outbound30'), n(p.last30.outboundClicks)],
        ],
        list(
          t('topPins'),
          p.top.map((x) => `${format.number(x.impressions)} · ${x.title || '—'}`),
        ),
      ),
    ),
    ...facts.tiktok.map((k) =>
      card('TIKTOK', k.name, [
        [t('followers'), n(k.followers)],
        [t('videos'), n(k.videos)],
      ]),
    ),
  ];

  return (
    <section className="card rounded-[24px] p-5">
      <h3 className="mb-3 flex items-center gap-1.5 text-sm font-semibold">
        {t('title')}
        <InfoTip text={t('hint')} />
        <span className="ml-auto text-xs font-normal text-muted">
          {t('links', { count: facts.links })}
        </span>
      </h3>
      {cards.length ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{cards}</div>
      ) : (
        <p className="text-sm text-muted">{t('empty')}</p>
      )}
    </section>
  );
}
