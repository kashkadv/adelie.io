'use client';

import { AlertTriangle, ArrowRight, Pin, Plug, RefreshCw } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useState } from 'react';
import { useProjectAccounts } from './accounts-data';
import { EmptyState, PageHeader } from './page-header';
import { useWorkspace } from './workspace-context';

const METRICS = ['impressions', 'saves', 'outboundClicks', 'followers'] as const;

export function Overview() {
  const t = useTranslations('Overview');
  const { project } = useWorkspace();
  const { accounts, connect, canConnect } = useProjectAccounts();
  const [connecting, setConnecting] = useState(false);
  const needsReauth = accounts?.filter((a) => a.status !== 'ACTIVE') ?? [];

  async function onConnect() {
    setConnecting(true);
    try {
      await connect('pinterest');
    } catch {
      setConnecting(false);
    }
  }

  return (
    <>
      <PageHeader
        title={t('title')}
        subtitle={project ? t('subtitle', { project: project.name }) : ' '}
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

      {/* Key metrics. No data yet → an honest dash, never 0 (PRD §6.4). */}
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {METRICS.map((key, i) => (
          <article
            key={key}
            className="card animate-rise rounded-[24px] p-5"
            style={{ animationDelay: `${40 + i * 40}ms` }}
          >
            <p className="text-sm text-muted">{t(`metrics.${key}`)}</p>
            <p className="tabular mt-3 font-display text-3xl font-semibold">—</p>
            <p className="mt-1 text-xs text-muted">{t('noData')}</p>
          </article>
        ))}
      </div>

      {accounts && accounts.length > 0 ? (
        <EmptyState
          icon={<RefreshCw size={24} strokeWidth={1.75} aria-hidden="true" />}
          title={t('connectedTitle', { count: accounts.length })}
          text={t('connectedText')}
          action={
            <Link href="/accounts" className="btn-primary mt-2 flex w-auto items-center gap-2 px-5">
              {t('openAccounts')}
              <ArrowRight size={16} aria-hidden="true" />
            </Link>
          }
        />
      ) : (
        <EmptyState
          icon={<Plug size={24} strokeWidth={1.75} aria-hidden="true" />}
          title={t('connectTitle')}
          text={t('connectText')}
          action={
            <button
              type="button"
              disabled={!canConnect || connecting || accounts === null}
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
