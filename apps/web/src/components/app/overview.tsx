'use client';

import { Pin, Plug } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { EmptyState, PageHeader } from './page-header';
import { useWorkspace } from './workspace-context';

const METRICS = ['impressions', 'saves', 'outboundClicks', 'followers'] as const;

export function Overview() {
  const t = useTranslations('Overview');
  const { project } = useWorkspace();

  return (
    <>
      <PageHeader
        title={t('title')}
        subtitle={project ? t('subtitle', { project: project.name }) : ' '}
      />

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

      <EmptyState
        icon={<Plug size={24} strokeWidth={1.75} aria-hidden="true" />}
        title={t('connectTitle')}
        text={t('connectText')}
        action={
          <button
            type="button"
            disabled
            className="btn-primary mt-2 flex w-auto items-center gap-2 px-5"
            title={t('soon')}
          >
            <Pin size={18} strokeWidth={1.75} aria-hidden="true" />
            {t('connectPinterest')}
            <span className="rounded-full border border-current/30 px-2 text-xs opacity-80">
              {t('soon')}
            </span>
          </button>
        }
      />
    </>
  );
}
