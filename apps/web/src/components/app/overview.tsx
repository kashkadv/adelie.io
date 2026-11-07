'use client';

import {
  AlertTriangle,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  Pin,
  Plug,
  RefreshCw,
} from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { InfoTip } from '../ui/info-tip';
import { Select } from '../ui/select';
import { useProjectAccounts } from './accounts-data';
import { ImpressionsChart, type SeriesPoint } from './impressions-chart';
import { EmptyState, PageHeader } from './page-header';
import { useWorkspace } from './workspace-context';

type Status = SeriesPoint['status'];
type Metric = { value: number | null; previous: number | null; status: Status; coverage: number };
type OverviewData = {
  period: { from: string; to: string; days: number };
  historyFrom: string | null;
  metrics: { impressions: Metric; saves: Metric; outboundClicks: Metric; followers: Metric };
  series: SeriesPoint[];
  devices: { key: string; value: number }[];
};

const PERIODS = [7, 30, 90] as const;
const METRICS = ['impressions', 'saves', 'outboundClicks', 'followers'] as const;
/** Device order and colors follow the validated chart palette (ADR-0009): slots 1–3. */
const DEVICE_COLORS: Record<string, string> = {
  MOBILE: 'var(--series-1)',
  WEB: 'var(--series-2)',
  TABLET: 'var(--series-3)',
};

function Delta({ metric }: { metric: Metric }) {
  const t = useTranslations('Overview');
  const format = useFormatter();
  if (metric.value === null || metric.previous === null) return null;
  if (metric.previous === 0) {
    return metric.value > 0 ? <span className="text-xs text-muted">{t('deltaNew')}</span> : null;
  }
  const change = (metric.value - metric.previous) / metric.previous;
  // Under 1% is "no change": no arrow or color that would suggest a trend.
  if (Math.abs(change) < 0.005) {
    return <span className="text-xs font-medium text-muted">≈ 0%</span>;
  }
  const up = change > 0;
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  return (
    <span
      className={`inline-flex items-center gap-0.5 text-xs font-medium ${
        up ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-700 dark:text-rose-400'
      }`}
      title={t('deltaHint')}
    >
      <Icon size={14} aria-hidden="true" />
      {format.number(Math.abs(change), { style: 'percent', maximumFractionDigits: 0 })}
      <span className="sr-only">{up ? t('deltaUp') : t('deltaDown')}</span>
    </span>
  );
}

function PeriodSwitch({ days, onChange }: { days: number; onChange: (d: number) => void }) {
  const t = useTranslations('Overview');
  return (
    <div className="flex rounded-2xl border border-line p-1" role="group" aria-label={t('period')}>
      {PERIODS.map((d) => (
        <button
          key={d}
          type="button"
          aria-pressed={days === d}
          onClick={() => onChange(d)}
          className={`rounded-xl px-3 py-1.5 text-sm transition-colors duration-200 ${
            days === d ? 'bg-accent text-accent-foreground' : 'text-muted hover:text-foreground'
          }`}
        >
          {t('days', { count: d })}
        </button>
      ))}
    </div>
  );
}

export function Overview() {
  const t = useTranslations('Overview');
  const format = useFormatter();
  const { workspace, project } = useWorkspace();
  const { accounts: allAccounts, connect, canConnect } = useProjectAccounts();
  // Disconnected and hidden accounts are left out (their history is kept).
  const accounts = allAccounts?.filter((a) => a.status !== 'REVOKED' && !a.hidden);
  const [connecting, setConnecting] = useState(false);
  const [days, setDays] = useState(30);
  const [accountId, setAccountId] = useState('');
  const [data, setData] = useState<OverviewData | null>(null);
  const needsReauth = accounts?.filter((a) => a.status === 'REAUTHORIZATION_REQUIRED') ?? [];
  const hasAccounts = !!accounts && accounts.length > 0;

  useEffect(() => {
    if (!workspace || !project || !hasAccounts) return;
    let cancelled = false;
    const q = new URLSearchParams({ days: String(days), ...(accountId ? { accountId } : {}) });
    api<OverviewData>(`/workspaces/${workspace.id}/projects/${project.id}/overview?${q}`).then(
      (d) => !cancelled && setData(d),
      () => !cancelled && setData(null),
    );
    return () => {
      cancelled = true;
    };
  }, [workspace, project, hasAccounts, days, accountId]);

  async function onConnect() {
    setConnecting(true);
    try {
      await connect('pinterest');
    } catch {
      setConnecting(false);
    }
  }

  const accountOptions = [
    { value: '', label: t('allAccounts') },
    ...(accounts ?? []).map((a) => ({
      value: a.id,
      label: a.displayName || a.username || a.externalId,
      hint: a.username ? `@${a.username}` : undefined,
    })),
  ];
  const deviceTotal = data?.devices.reduce((s, d) => s + d.value, 0) ?? 0;

  return (
    <>
      <PageHeader
        title={t('title')}
        subtitle={project ? t('subtitle', { project: project.name }) : ' '}
        action={
          hasAccounts ? (
            <div className="flex flex-wrap items-center gap-2">
              {accounts.length > 1 && (
                <div className="w-56">
                  <Select
                    value={accountId}
                    onChange={setAccountId}
                    options={accountOptions}
                    ariaLabel={t('account')}
                  />
                </div>
              )}
              <PeriodSwitch days={days} onChange={setDays} />
            </div>
          ) : undefined
        }
      />

      {/* Connection problems are shown in the app only for now (ADR-0011). */}
      {needsReauth.length > 0 && (
        <Link
          href="/accounts"
          className="animate-rise mb-6 flex items-center gap-3 rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-800 dark:text-amber-300"
        >
          <AlertTriangle size={18} className="shrink-0" aria-hidden="true" />
          <span className="flex-1">{t('reauthBanner', { count: needsReauth.length })}</span>
          <ArrowRight size={16} aria-hidden="true" />
        </Link>
      )}

      {/* Key metrics. No data → an honest dash, never 0 (PRD §6.4). */}
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {METRICS.map((key, i) => {
          const m = data?.metrics[key];
          const preliminary = m && m.value !== null && m.status !== 'READY';
          return (
            <article
              key={key}
              className="card animate-rise rounded-[24px] p-5"
              style={{ animationDelay: `${40 + i * 40}ms` }}
            >
              <p className="flex items-center gap-1.5 text-sm text-muted">
                {t(`metrics.${key}`)}
                {preliminary && <InfoTip text={t('preliminaryHint')} />}
              </p>
              <p className="tabular mt-3 font-display text-3xl font-semibold">
                {m?.value == null ? '—' : format.number(m.value)}
              </p>
              <p className="mt-1 flex items-center gap-2 text-xs text-muted">
                {m?.value == null ? (
                  t('noData')
                ) : (
                  <>
                    <Delta metric={m} />
                    <span>{key === 'followers' ? t('now') : t('vsPrevious', { count: days })}</span>
                  </>
                )}
              </p>
            </article>
          );
        })}
      </div>

      {hasAccounts && data && (
        <div className="grid gap-4 xl:grid-cols-3">
          <section
            className="card animate-rise rounded-[24px] p-5 xl:col-span-2"
            style={{ animationDelay: '200ms' }}
          >
            <h2 className="mb-1 flex items-center gap-1.5 px-1 text-lg font-semibold">
              {t('chart.title')}
              <InfoTip text={t('chart.hint')} />
            </h2>
            <p className="mb-3 px-1 text-xs text-muted">
              {format.dateTimeRange(
                new Date(`${data.period.from}T00:00:00Z`),
                new Date(`${data.period.to}T00:00:00Z`),
                { day: 'numeric', month: 'short', timeZone: 'UTC' },
              )}
            </p>
            <ImpressionsChart points={data.series} />
          </section>

          <section
            className="card animate-rise rounded-[24px] p-5"
            style={{ animationDelay: '240ms' }}
          >
            <h2 className="mb-4 px-1 text-lg font-semibold">{t('devices.title')}</h2>
            {deviceTotal > 0 ? (
              <>
                <div
                  className="mb-5 flex h-3 overflow-hidden rounded-full"
                  role="img"
                  aria-label={t('devices.title')}
                >
                  {data.devices.map((d, i) => (
                    <span
                      key={d.key}
                      style={{
                        width: `${(d.value / deviceTotal) * 100}%`,
                        background: DEVICE_COLORS[d.key] ?? 'var(--muted)',
                        marginLeft: i ? 2 : 0,
                      }}
                    />
                  ))}
                </div>
                <ul className="space-y-3">
                  {data.devices.map((d) => (
                    <li key={d.key} className="flex items-center gap-3 px-1 text-sm">
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ background: DEVICE_COLORS[d.key] ?? 'var(--muted)' }}
                        aria-hidden="true"
                      />
                      <span className="flex-1">
                        {['MOBILE', 'WEB', 'TABLET'].includes(d.key)
                          ? t(`devices.${d.key as 'MOBILE' | 'WEB' | 'TABLET'}`)
                          : d.key}
                      </span>
                      <span className="tabular text-muted">
                        {format.number(d.value / deviceTotal, {
                          style: 'percent',
                          maximumFractionDigits: 0,
                        })}
                      </span>
                      <span className="tabular w-16 text-right font-medium">
                        {format.number(d.value)}
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="px-1 text-sm text-muted">{t('noData')}</p>
            )}
          </section>
        </div>
      )}

      {accounts && accounts.length === 0 && (
        <EmptyState
          icon={<Plug size={24} strokeWidth={1.75} aria-hidden="true" />}
          title={t('connectTitle')}
          text={t('connectText')}
          action={
            <button
              type="button"
              disabled={!canConnect || connecting}
              onClick={onConnect}
              className="btn-primary mt-2 flex w-auto items-center gap-2 px-5"
            >
              {connecting ? (
                <RefreshCw size={18} className="animate-spin" aria-hidden="true" />
              ) : (
                <Pin size={18} strokeWidth={1.75} aria-hidden="true" />
              )}
              {t('connectPinterest')}
            </button>
          }
        />
      )}
    </>
  );
}
