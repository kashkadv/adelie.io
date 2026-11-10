'use client';

import { ChevronLeft, ChevronRight, Waves, Globe } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { apiUrl } from '@/lib/auth-client';
import { InfoTip } from '../ui/info-tip';
import { FlipperCheckout } from './flipper-checkout';
import { FlipperSources } from './flipper-sources';
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
    consentMode: 'anonymous' | 'granted';
    serverKeyHint: string | null;
    createdAt: string;
    lastEventAt: string | null;
    events7d: number;
  } | null;
};

type Summary = {
  days: number;
  counts: { name: string; events: number; visitors: number }[];
  daily: { day: string; visitors: number; views: number }[];
  funnel: { name: string; visitors: number }[];
  channels: { channel: string; visits: number }[];
  products: {
    item: string;
    views: number;
    visitors: number;
    title: string | null;
    url: string | null;
  }[];
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

type Tab = 'analytics' | 'sources' | 'checkout' | 'live' | 'settings';

const PAGE_SIZE = 25;

/** Every day of the period, days without visitors as zero (the server sends only days with data). */
function daily(summary: Summary | null) {
  if (!summary) return [];
  const byDay = new Map(summary.daily.map((d) => [d.day, d.visitors]));
  const today = new Date();
  return Array.from({ length: summary.days }, (_, i) => {
    const day = new Date(
      Date.UTC(
        today.getUTCFullYear(),
        today.getUTCMonth(),
        today.getUTCDate() - (summary.days - 1 - i),
      ),
    )
      .toISOString()
      .slice(0, 10);
    return { date: day, value: byDay.get(day) ?? 0, status: 'READY' as const };
  });
}

const STANDARD = [
  'PageView',
  'ViewCategory',
  'ProductView',
  'AddToCart',
  'BeginCheckout',
  'Purchase',
] as const;
const PERIODS = ['today', '7', '30', '90'] as const;
const PRODUCTS_PER_PAGE = 10;

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
  const [eventsTotal, setEventsTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [productPage, setProductPage] = useState(1);
  const [tabChoice, setTabChoice] = useState<Tab | null>(null);
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
  const tab: Tab = tabChoice ?? (site?.lastEventAt ? 'analytics' : 'settings');

  // What arrived: the summary for the period, and the latest events — fresh every few seconds.
  useEffect(() => {
    if (!base || !current || !site) return;
    let cancelled = false;
    const load = () => {
      if (document.visibilityState === 'hidden' || tab !== 'live') return;
      void api<{ total: number; rows: LiveEvent[] }>(
        `${base}/${current.id}/events?limit=${PAGE_SIZE}&page=${page}&days=${days}`,
      ).then(
        (e) => {
          if (cancelled) return;
          setEvents(e.rows);
          setEventsTotal(e.total);
        },
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
  }, [base, current, site, days, page, tab]);

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

  const [newKey, setNewKey] = useState<string | null>(null);
  async function makeKey() {
    if (!base || !current) return;
    setBusy(true);
    try {
      const r = await api<{ key: string }>(`${base}/${current.id}/server-key`, { method: 'POST' });
      setNewKey(r.key);
      setVersion((v) => v + 1);
    } finally {
      setBusy(false);
    }
  }

  async function setMode(consentMode: 'anonymous' | 'granted') {
    if (!base || !current) return;
    setBusy(true);
    try {
      await api(`${base}/${current.id}`, { method: 'PATCH', json: { consentMode } });
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
  const people = (name: string) => summary?.counts.find((c) => c.name === name)?.visitors ?? 0;

  if (sites && sites.length === 0) {
    return (
      <>
        <PageHeader title={t('title')} subtitle={t('subtitle')} />
        <EmptyState
          icon={<Waves size={24} strokeWidth={1.75} aria-hidden="true" />}
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
  const channelTotal = (summary?.channels ?? []).reduce((n, c) => n + c.visits, 0);
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
                setPage(1);
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
          icon={<Waves size={24} strokeWidth={1.75} aria-hidden="true" />}
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
          <div className="animate-rise mb-5 flex flex-wrap items-center justify-between gap-3">
            <Segmented
              ariaLabel={t('title')}
              value={tab}
              onChange={setTabChoice}
              options={[
                { value: 'analytics', label: t('tabAnalytics') },
                { value: 'sources', label: t('tabSources') },
                { value: 'checkout', label: t('tabCheckout') },
                { value: 'live', label: t('live') },
                { value: 'settings', label: t('tabSettings') },
              ]}
            />
            {tab !== 'settings' && (
              <Segmented
                ariaLabel={t('period')}
                value={days}
                onChange={(d) => {
                  setDays(d);
                  setPage(1);
                  setProductPage(1);
                  setSummary(null);
                }}
                options={PERIODS.map((p) => ({
                  value: p,
                  label: p === 'today' ? t('today') : t('days', { count: Number(p) }),
                }))}
              />
            )}
          </div>

          {tab === 'settings' && (
            <>
              <section className="card animate-rise mb-6 rounded-[24px] p-5">
                <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1">
                  <h2 className="text-sm font-semibold">{t('install')}</h2>
                  <span className="flex items-center gap-2 text-xs text-muted">
                    <span
                      aria-hidden="true"
                      className={`h-2 w-2 rounded-full ${live ? 'bg-emerald-500' : 'bg-amber-500'}`}
                    />
                    {site.lastEventAt
                      ? t('lastEvent', { date: date(site.lastEventAt) })
                      : t('waiting')}
                  </span>
                  <span className="text-xs text-muted">
                    {t('siteId')}: <span className="tabular text-foreground">{site.publicId}</span>
                  </span>
                </div>
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <span className="flex items-center gap-1.5 text-xs text-muted">
                    {t('mode')}
                    <InfoTip text={t('modeHint')} />
                  </span>
                  <Segmented
                    ariaLabel={t('mode')}
                    value={site.consentMode}
                    onChange={(m) => !busy && setMode(m)}
                    options={[
                      { value: 'anonymous', label: t('modeAnonymous') },
                      { value: 'granted', label: t('modeGranted') },
                    ]}
                  />
                </div>
                <CodeBlock
                  code={installSnippet(`${apiUrl}/flipper.js?site=${site.publicId}`, site.publicId)}
                  label={t('install')}
                />
              </section>

              <section className="card animate-rise mb-6 rounded-[24px] p-5">
                <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2">
                  <h2 className="flex items-center gap-1.5 text-sm font-semibold">
                    {t('serverTitle')}
                    <InfoTip text={t('serverHint')} />
                  </h2>
                  <span className="text-xs text-muted">
                    {site.serverKeyHint
                      ? t('serverKeySet', { hint: site.serverKeyHint })
                      : t('serverKeyNone')}
                  </span>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      if (!site.serverKeyHint || window.confirm(t('serverRegenerate')))
                        void makeKey();
                    }}
                    className="rounded-full border border-line px-3 py-1 text-xs hover:text-foreground"
                  >
                    {site.serverKeyHint ? t('serverNewKey') : t('serverMakeKey')}
                  </button>
                </div>
                <p className="mb-2 text-xs text-muted">{t('serverUrl')}</p>
                <CodeBlock code={`POST ${apiUrl}/collect/server`} label={t('serverUrl')} />
                {newKey && (
                  <>
                    <CodeBlock code={newKey} label={t('serverTitle')} />
                    <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">
                      {t('serverShownOnce')}
                    </p>
                  </>
                )}
              </section>

              <h2 className="mb-3 px-3.5 text-lg font-semibold">{t('guideTitle')}</h2>
              <FlipperGuide scriptUrl={`${apiUrl}/flipper.js`} siteId={site.publicId} />
            </>
          )}

          {tab === 'checkout' && base && (
            <FlipperCheckout base={base} accountId={current.id} days={days} />
          )}

          {tab === 'sources' && base && (
            <FlipperSources base={base} accountId={current.id} days={days} />
          )}

          {tab === 'live' && (
            <>
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
                        <span className="w-56 shrink-0 truncate font-medium">{e.name}</span>
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
                {eventsTotal > PAGE_SIZE && (
                  <nav
                    aria-label={t('live')}
                    className="flex items-center justify-end gap-3 border-t border-line px-5 py-3 text-xs text-muted"
                  >
                    <span className="tabular">
                      {t('liveRange', {
                        from: (page - 1) * PAGE_SIZE + 1,
                        to: Math.min(page * PAGE_SIZE, eventsTotal),
                        total: eventsTotal,
                      })}
                    </span>
                    <button
                      type="button"
                      disabled={page <= 1}
                      onClick={() => setPage((n) => n - 1)}
                      aria-label={t('livePrev')}
                      className="rounded-lg border border-line p-1.5 hover:text-foreground"
                    >
                      <ChevronLeft size={14} aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      disabled={page * PAGE_SIZE >= eventsTotal}
                      onClick={() => setPage((n) => n + 1)}
                      aria-label={t('liveNext')}
                      className="rounded-lg border border-line p-1.5 hover:text-foreground"
                    >
                      <ChevronRight size={14} aria-hidden="true" />
                    </button>
                  </nav>
                )}
              </section>
            </>
          )}

          {tab === 'analytics' && (
            <>
              <div className="animate-rise mb-4 flex flex-wrap items-center gap-3">
                {summary && total > 0 && (
                  <span className="flex items-center gap-1.5 text-xs text-muted">
                    {t('consentShare', {
                      percent: Math.round((summary.consent.consenting / total) * 100),
                    })}
                    <InfoTip text={t('consentHint')} />
                  </span>
                )}
              </div>

              <dl className="animate-rise mb-6 grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
                {STANDARD.map((n) => (
                  <div key={n} className="rounded-2xl bg-hover px-3 py-2.5">
                    <dt className="text-xs text-muted">{t(`events.${n}`)}</dt>
                    <dd className="tabular mt-0.5 font-display text-lg font-semibold">
                      {summary ? format.number(count(n)) : '—'}
                    </dd>
                    {summary && (
                      <dd className="tabular text-xs text-muted">
                        {t('tileVisitors', { count: people(n) })}
                      </dd>
                    )}
                  </div>
                ))}
              </dl>

              {days !== 'today' && (
                <section className="card animate-rise mb-6 rounded-[24px] p-5">
                  <h2 className="mb-1 flex items-center gap-1.5 text-sm font-semibold">
                    {t('visitorsPerDay')}
                    <InfoTip text={t('visitorsHint')} />
                  </h2>
                  <ImpressionsChart points={daily(summary)} ariaLabel={t('visitorsPerDay')} />
                </section>
              )}

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
                              {i > 0 && previous > 0 && (
                                <span className="mr-2 text-xs text-muted">
                                  {Math.round((step.visitors / previous) * 100)}%
                                </span>
                              )}
                              {format.number(step.visitors)}
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
                    <ul className="grid gap-3">
                      {(summary?.channels ?? []).map((c) => {
                        const share = channelTotal ? (c.visits / channelTotal) * 100 : 0;
                        return (
                          <li key={c.channel}>
                            <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
                              <span>{c.channel}</span>
                              <span className="tabular">
                                <span className="mr-2 text-xs text-muted">
                                  {Math.round(share)}%
                                </span>
                                {format.number(c.visits)}
                              </span>
                            </div>
                            <div className="h-2 overflow-hidden rounded-full bg-hover">
                              <div
                                className="h-full rounded-full bg-accent"
                                style={{ width: `${share}%` }}
                              />
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </section>
              </div>

              {summary && summary.products.length > 0 && (
                <section className="card animate-rise mb-6 overflow-hidden rounded-[24px]">
                  <h2 className="px-5 pt-5 pb-3 text-sm font-semibold">{t('topProducts')}</h2>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-line text-left text-xs text-muted">
                        <th className="px-5 pb-2 font-normal">{t('productCol')}</th>
                        <th className="px-3 pb-2 text-right font-normal">{t('viewsCol')}</th>
                        <th className="px-5 pb-2 text-right font-normal">{t('visitorsCol')}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line">
                      {summary.products
                        .slice(
                          (productPage - 1) * PRODUCTS_PER_PAGE,
                          productPage * PRODUCTS_PER_PAGE,
                        )
                        .map((p) => (
                          <tr key={p.item}>
                            <td className="max-w-0 px-5 py-2.5">
                              <div className="flex items-baseline">
                                {p.url ? (
                                  <a
                                    href={p.url}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="min-w-0 truncate hover:underline"
                                    title={p.title ?? p.item}
                                  >
                                    {p.title ?? p.item}
                                  </a>
                                ) : (
                                  <span className="min-w-0 truncate">{p.title ?? p.item}</span>
                                )}
                                {p.title && (
                                  <span className="tabular ml-2 shrink-0 text-xs text-muted">
                                    {p.item}
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="tabular px-3 py-2.5 text-right">
                              {format.number(p.views)}
                            </td>
                            <td className="tabular px-5 py-2.5 text-right">
                              {format.number(p.visitors)}
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                  {summary.products.length > PRODUCTS_PER_PAGE && (
                    <nav
                      aria-label={t('topProducts')}
                      className="flex items-center justify-end gap-3 border-t border-line px-5 py-3 text-xs text-muted"
                    >
                      <span className="tabular">
                        {t('liveRange', {
                          from: (productPage - 1) * PRODUCTS_PER_PAGE + 1,
                          to: Math.min(productPage * PRODUCTS_PER_PAGE, summary.products.length),
                          total: summary.products.length,
                        })}
                      </span>
                      <button
                        type="button"
                        disabled={productPage <= 1}
                        onClick={() => setProductPage((n) => n - 1)}
                        aria-label={t('pagePrev')}
                        className="rounded-lg border border-line p-1.5 hover:text-foreground"
                      >
                        <ChevronLeft size={14} aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        disabled={productPage * PRODUCTS_PER_PAGE >= summary.products.length}
                        onClick={() => setProductPage((n) => n + 1)}
                        aria-label={t('pageNext')}
                        className="rounded-lg border border-line p-1.5 hover:text-foreground"
                      >
                        <ChevronRight size={14} aria-hidden="true" />
                      </button>
                    </nav>
                  )}
                </section>
              )}
            </>
          )}
        </>
      )}
    </>
  );
}
