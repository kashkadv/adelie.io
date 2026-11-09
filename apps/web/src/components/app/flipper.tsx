'use client';

import { Footprints, Globe } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { apiUrl } from '@/lib/auth-client';
import { InfoTip } from '../ui/info-tip';
import { Segmented } from '../ui/segmented';
import { CONNECT_ROLES } from './accounts-data';
import { CodeBlock, FlipperGuide, installSnippet } from './flipper-guide';
import { ImpressionsChart } from './impressions-chart';
import { EmptyState, PageHeader } from './page-header';
import { useWorkspace } from './workspace-context';

type Site = {
  id: string;
  username: string | null;
  displayName: string | null;
  host: string | null;
  site: {
    publicId: string;
    allowedHosts: string[];
    createdAt: string;
    lastEventAt: string | null;
    events7d: number;
  } | null;
};

type Summary = {
  days: number;
  counts: { name: string; events: number }[];
  daily: { day: string; visitors: number; views: number }[];
  funnel: { name: string; visitors: number }[];
  channels: { channel: string; views: number }[];
  products: { item: string; views: number; visitors: number }[];
  consent: { consenting: number; anonymous: number };
};

type LiveEvent = {
  id: string;
  name: string;
  occurredAt: string;
  consent: boolean;
  url: string;
  channel: string | null;
  source: string | null;
  medium: string | null;
  device: string | null;
  properties: Record<string, unknown> | null;
  visitor: string | null;
};

const STANDARD = ['PageView', 'ViewCategory', 'ProductView', 'AddToCart', 'BeginCheckout'] as const;
const PERIODS = ['7', '30', '90'] as const;

/** A path and what it asks for, as a short line: "/product/00022502". */
const shortUrl = (url: string) => {
  try {
    const u = new URL(url);
    return `${u.pathname}${u.search}`;
  } catch {
    return url;
  }
};

/** Flipper: the tracker of the project's sites (ADR-0022) — set-up, what arrives, the guide. */
export function Flipper() {
  const t = useTranslations('Flipper');
  const format = useFormatter();
  const { workspace, project } = useWorkspace();
  const canManage = !!workspace && CONNECT_ROLES.includes(workspace.role);
  const base =
    workspace && project ? `/workspaces/${workspace.id}/projects/${project.id}/flipper` : null;

  const [sites, setSites] = useState<Site[] | null>(null);
  const [chosen, setChosen] = useState('');
  const [days, setDays] = useState<(typeof PERIODS)[number]>('7');
  const [summary, setSummary] = useState<Summary | null>(null);
  const [events, setEvents] = useState<LiveEvent[] | null>(null);
  const [busy, setBusy] = useState(false);

  /** Bumped to read the sites again (after switching one on). */
  const [version, setVersion] = useState(0);
  useEffect(() => {
    if (!base) return;
    let cancelled = false;
    api<Site[]>(base).then(
      (list) => !cancelled && setSites(list),
      () => !cancelled && setSites([]),
    );
    return () => {
      cancelled = true;
    };
  }, [base, version]);
  // "Now", for the live / waiting dot: read when the page opens and every half minute.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const current = sites?.find((s) => s.id === chosen) ?? sites?.[0];
  const site = current?.site ?? null;

  // What arrived: the summary for the period, and the latest events — fresh every few seconds.
  useEffect(() => {
    if (!base || !current || !site) return;
    let cancelled = false;
    const load = () => {
      if (document.visibilityState === 'hidden') return;
      void api<LiveEvent[]>(`${base}/${current.id}/events?limit=40`).then(
        (e) => !cancelled && setEvents(e),
        () => undefined,
      );
    };
    void api<Summary>(`${base}/${current.id}/summary?days=${days}`).then(
      (s) => !cancelled && setSummary(s),
      () => undefined,
    );
    load();
    const timer = setInterval(load, 8000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [base, current, site, days]);

  async function enable() {
    if (!base || !current) return;
    setBusy(true);
    try {
      await api(`${base}/${current.id}`, { method: 'POST' });
      setVersion((v) => v + 1);
    } finally {
      setBusy(false);
    }
  }

  const name = (s: Site) => s.displayName || s.username || s.host || '';
  const date = (iso: string) =>
    format.dateTime(new Date(iso), { dateStyle: 'medium', timeStyle: 'short' });
  const time = (iso: string) => format.dateTime(new Date(iso), { timeStyle: 'medium' });
  const count = (name: string) => summary?.counts.find((c) => c.name === name)?.events ?? 0;

  if (sites && sites.length === 0) {
    return (
      <>
        <PageHeader title={t('title')} subtitle={t('subtitle')} />
        <EmptyState
          icon={<Footprints size={24} strokeWidth={1.75} aria-hidden="true" />}
          title={t('noSitesTitle')}
          text={t('noSitesText')}
          action={
            <Link href="/connections" className="btn-primary w-auto px-5">
              {t('connectSite')}
            </Link>
          }
        />
      </>
    );
  }

  const live = site?.lastEventAt && now - new Date(site.lastEventAt).getTime() < 24 * 3600 * 1000;
  const total = summary ? summary.consent.consenting + summary.consent.anonymous : 0;
  const funnelTop = Math.max(1, ...(summary?.funnel.map((f) => f.visitors) ?? [0]));

  return (
    <>
      <PageHeader
        title={t('title')}
        subtitle={t('subtitle')}
        action={
          sites && sites.length > 1 ? (
            <Segmented
              ariaLabel={t('site')}
              value={current?.id ?? ''}
              onChange={(id) => {
                setChosen(id);
                setSummary(null);
                setEvents(null);
              }}
              options={sites.map((s) => ({
                value: s.id,
                label: (
                  <>
                    <Globe size={14} strokeWidth={1.75} aria-hidden="true" />
                    {name(s)}
                  </>
                ),
              }))}
            />
          ) : undefined
        }
      />

      {current && !site && (
        <EmptyState
          icon={<Footprints size={24} strokeWidth={1.75} aria-hidden="true" />}
          title={t('enableTitle', { site: name(current) })}
          text={t('enableText')}
          action={
            canManage ? (
              <button
                type="button"
                onClick={enable}
                disabled={busy}
                className="btn-primary w-auto px-5"
              >
                {t('enable')}
              </button>
            ) : (
              <p className="text-sm text-muted">{t('noPermission')}</p>
            )
          }
        />
      )}

      {current && site && (
        <>
          <section className="card animate-rise mb-6 rounded-[24px] p-5">
            <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1">
              <h2 className="text-sm font-semibold">{t('install')}</h2>
              <span className="flex items-center gap-2 text-xs text-muted">
                <span
                  aria-hidden="true"
                  className={`h-2 w-2 rounded-full ${live ? 'bg-emerald-500' : 'bg-amber-500'}`}
                />
                {site.lastEventAt ? t('lastEvent', { date: date(site.lastEventAt) }) : t('waiting')}
              </span>
              <span className="text-xs text-muted">
                {t('siteId')}: <span className="tabular text-foreground">{site.publicId}</span>
              </span>
            </div>
            <CodeBlock
              code={installSnippet(`${apiUrl}/flipper.js`, site.publicId)}
              label={t('install')}
            />
          </section>

          <div className="animate-rise mb-4 flex flex-wrap items-center gap-3">
            <Segmented
              ariaLabel={t('period')}
              value={days}
              onChange={setDays}
              options={PERIODS.map((p) => ({ value: p, label: t('days', { count: Number(p) }) }))}
            />
            {summary && total > 0 && (
              <span className="flex items-center gap-1.5 text-xs text-muted">
                {t('consentShare', {
                  percent: Math.round((summary.consent.consenting / total) * 100),
                })}
                <InfoTip text={t('consentHint')} />
              </span>
            )}
          </div>

          <dl className="animate-rise mb-6 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
            {STANDARD.map((n) => (
              <div key={n} className="rounded-2xl bg-hover px-4 py-3">
                <dt className="text-xs text-muted">{t(`events.${n}`)}</dt>
                <dd className="tabular mt-1 font-display text-xl font-semibold">
                  {summary ? format.number(count(n)) : '—'}
                </dd>
              </div>
            ))}
          </dl>

          <section className="card animate-rise mb-6 rounded-[24px] p-5">
            <h2 className="mb-1 flex items-center gap-1.5 text-sm font-semibold">
              {t('visitorsPerDay')}
              <InfoTip text={t('visitorsHint')} />
            </h2>
            <ImpressionsChart
              points={(summary?.daily ?? []).map((d) => ({
                date: d.day,
                value: d.visitors,
                status: 'READY' as const,
              }))}
              ariaLabel={t('visitorsPerDay')}
            />
          </section>

          <div className="mb-6 grid gap-6 lg:grid-cols-2">
            <section className="card animate-rise rounded-[24px] p-5">
              <h2 className="mb-3 flex items-center gap-1.5 text-sm font-semibold">
                {t('funnel')}
                <InfoTip text={t('funnelHint')} />
              </h2>
              <ul className="grid gap-3">
                {(summary?.funnel ?? []).map((step, i, all) => {
                  const previous = i > 0 ? all[i - 1]!.visitors : 0;
                  return (
                    <li key={step.name}>
                      <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
                        <span>{t(`events.${step.name as 'ViewCategory'}`)}</span>
                        <span className="tabular">
                          {format.number(step.visitors)}
                          {i > 0 && previous > 0 && (
                            <span className="ml-2 text-xs text-muted">
                              {Math.round((step.visitors / previous) * 100)}%
                            </span>
                          )}
                        </span>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-hover">
                        <div
                          className="h-full rounded-full bg-accent"
                          style={{ width: `${(step.visitors / funnelTop) * 100}%` }}
                        />
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>

            <section className="card animate-rise rounded-[24px] p-5">
              <h2 className="mb-3 text-sm font-semibold">{t('channels')}</h2>
              {summary && summary.channels.length === 0 ? (
                <p className="text-sm text-muted">{t('noChannels')}</p>
              ) : (
                <ul className="grid gap-2 text-sm">
                  {(summary?.channels ?? []).map((c) => (
                    <li key={c.channel} className="flex justify-between gap-3">
                      <span>{c.channel}</span>
                      <span className="tabular text-muted">{format.number(c.views)}</span>
                    </li>
                  ))}
                </ul>
              )}
              {summary && summary.products.length > 0 && (
                <>
                  <h2 className="mt-5 mb-3 text-sm font-semibold">{t('topProducts')}</h2>
                  <ul className="grid gap-2 text-sm">
                    {summary.products.map((p) => (
                      <li key={p.item} className="flex justify-between gap-3">
                        <span className="tabular">{p.item}</span>
                        <span className="tabular text-muted">
                          {t('productViews', { views: p.views, visitors: p.visitors })}
                        </span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </section>
          </div>

          <section className="card animate-rise mb-6 overflow-hidden rounded-[24px]">
            <h2 className="flex items-center gap-1.5 border-b border-line px-5 py-4 text-sm font-semibold">
              {t('live')}
              <InfoTip text={t('liveHint')} />
            </h2>
            {!events ? (
              <p className="px-5 py-8 text-center text-sm text-muted">…</p>
            ) : events.length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-muted">{t('noEvents')}</p>
            ) : (
              <ul className="divide-y divide-line">
                {events.map((e) => (
                  <li
                    key={e.id}
                    className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-2.5 text-sm"
                  >
                    <span className="tabular w-20 shrink-0 text-xs text-muted">
                      {time(e.occurredAt)}
                    </span>
                    <span className="w-32 shrink-0 font-medium">{e.name}</span>
                    <span className="min-w-0 flex-1 truncate text-muted" title={e.url}>
                      {shortUrl(e.url)}
                    </span>
                    {e.channel && (
                      <span className="rounded-full border border-line px-2 text-xs leading-5">
                        {e.channel}
                      </span>
                    )}
                    {e.visitor && (
                      <span
                        className="tabular text-xs text-muted"
                        title={e.consent ? t('known') : t('anonymous')}
                      >
                        {e.consent ? '●' : '○'} {e.visitor}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <h2 className="mb-3 px-3.5 text-lg font-semibold">{t('guideTitle')}</h2>
          <FlipperGuide scriptUrl={`${apiUrl}/flipper.js`} siteId={site.publicId} />
        </>
      )}
    </>
  );
}
