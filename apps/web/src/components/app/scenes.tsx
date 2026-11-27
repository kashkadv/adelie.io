'use client';

import { Cpu, Images, Plus, ScrollText, Search, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { apiUrl } from '@/lib/auth-client';
import { InfoTip } from '../ui/info-tip';
import { CONNECT_ROLES } from './accounts-data';
import { EmptyState, PageHeader } from './page-header';
import { LocationDialog, PcDialog, RulesDialog } from './scenes-dialogs';
import type { Gpu, GpuState, LocationCard } from './scenes-data';
import { useWorkspace } from './workspace-context';

const GPU_DOT: Record<GpuState, string> = {
  ready: 'bg-emerald-500',
  busy: 'bg-amber-400',
  offline: 'bg-zinc-400',
};

/** The PC's state, with what it means for jobs. */
export function GpuPill({ gpu }: { gpu: Gpu }) {
  const t = useTranslations('Scenes');
  return (
    <span className="flex h-10 items-center gap-2 rounded-2xl border border-line px-3 text-sm text-muted">
      <span className={`h-2.5 w-2.5 rounded-full ${GPU_DOT[gpu.state]}`} aria-hidden="true" />
      {t(`gpu.${gpu.state}`)}
      <InfoTip text={gpu.workers ? t(`gpuHint.${gpu.state}`) : t('gpuHint.none')} />
    </span>
  );
}

/**
 * Scenes of the Workshop (ADR-0042): the project's locations - photoshoot places (a chalet, a hotel) - as cards with a
 * cover; scenes are added and chosen inside a location.
 */
export function Scenes() {
  const t = useTranslations('Scenes');
  const router = useRouter();
  const { workspace, project } = useWorkspace();
  const canManage = !!workspace && CONNECT_ROLES.includes(workspace.role);
  const base = workspace && project ? `/workspaces/${workspace.id}/projects/${project.id}` : null;
  const [data, setData] = useState<{ locations: LocationCard[]; gpu: Gpu } | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [search, setSearch] = useState('');
  const [dialog, setDialog] = useState<'location' | 'pc' | 'rules' | null>(null);

  useEffect(() => {
    if (!base) return;
    let cancelled = false;
    const load = () =>
      api<{ locations: LocationCard[]; gpu: Gpu }>(`${base}/scenes`).then(
        (r) => !cancelled && setData(r),
        () =>
          !cancelled &&
          setData((d) => d ?? { locations: [], gpu: { state: 'offline', workers: 0 } }),
      );
    void load();
    const timer = setInterval(() => document.visibilityState === 'visible' && void load(), 15_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [base]);

  const all = data?.locations ?? [];
  const locations = all.filter((l) => !l.archivedAt);
  const archived = all.filter((l) => l.archivedAt);
  const needle = search.trim().toLowerCase();
  const shown = (showArchived ? archived : locations).filter(
    (l) => !needle || l.name.toLowerCase().includes(needle),
  );

  return (
    <>
      <PageHeader
        title={t('title')}
        subtitle={t('subtitle')}
        action={
          <div className="flex flex-wrap items-center gap-2">
            {data && <GpuPill gpu={data.gpu} />}
            {canManage && (
              <button
                type="button"
                onClick={() => setDialog('rules')}
                className="icon-btn h-10 w-10"
                title={t('rules')}
                aria-label={t('rules')}
              >
                <ScrollText size={17} aria-hidden="true" />
              </button>
            )}
            {canManage && (
              <button
                type="button"
                onClick={() => setDialog('pc')}
                className="icon-btn h-10 w-10"
                title={t('pcTitle')}
                aria-label={t('pcTitle')}
              >
                <Cpu size={17} aria-hidden="true" />
              </button>
            )}
          </div>
        }
      />

      {!data ? (
        <p className="py-10 text-center text-sm text-muted">…</p>
      ) : all.length === 0 ? (
        <EmptyState
          icon={<Images size={22} strokeWidth={1.75} aria-hidden="true" />}
          title={t('emptyTitle')}
          text={t('emptyText')}
          action={
            canManage ? (
              <button
                type="button"
                onClick={() => setDialog('location')}
                className="btn-primary w-auto px-5"
              >
                {t('locationNew')}
              </button>
            ) : undefined
          }
        />
      ) : (
        <>
          <label className="animate-rise mb-5 flex h-10 w-full items-center gap-2 rounded-full border border-line px-4 text-sm focus-within:border-[var(--field-focus)] sm:w-80">
            <Search size={15} className="shrink-0 text-muted" aria-hidden="true" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('searchLocations')}
              aria-label={t('searchLocations')}
              className="w-full min-w-0 bg-transparent outline-none placeholder:text-muted"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                aria-label={t('clearSearch')}
                className="text-muted hover:text-foreground"
              >
                <X size={14} aria-hidden="true" />
              </button>
            )}
          </label>
          {needle && shown.length === 0 && (
            <p className="py-6 text-sm text-muted">{t('noLocationsFound')}</p>
          )}
          <div className="animate-rise grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
            {shown.map((l) => (
              <Link
                key={l.id}
                href={`/scenes/${l.id}`}
                className="card overflow-hidden rounded-[22px] transition-[transform,box-shadow] duration-300 ease-(--ease-soft) hover:-translate-y-0.5"
              >
                <div className="relative aspect-[4/3] bg-hover">
                  {l.coverAssetId && base ? (
                    // eslint-disable-next-line @next/next/no-img-element -- served by the API with the session cookie
                    <img
                      src={`${apiUrl}${base}/assets/${l.coverAssetId}`}
                      alt=""
                      loading="lazy"
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <span className="flex h-full items-center justify-center text-muted">
                      <Images size={28} strokeWidth={1.5} aria-hidden="true" />
                    </span>
                  )}
                  {l.fresh > 0 && (
                    <span className="absolute top-3 right-3 rounded-full bg-accent px-2.5 py-1 text-xs font-semibold text-accent-foreground">
                      {t('freshBadge', { count: l.fresh })}
                    </span>
                  )}
                </div>
                <div className="p-4">
                  <p className="truncate font-semibold">{l.name}</p>
                  <p className="mt-1 truncate text-sm text-muted">
                    {l.description || t(`directions.${l.direction}`)}
                  </p>
                  {l.sceneTypes.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {l.sceneTypes.map((s) => (
                        <span key={s.key} className="rounded-full bg-hover px-2.5 py-0.5 text-xs">
                          {s.label}
                        </span>
                      ))}
                    </div>
                  )}
                  <p className="mt-3 text-sm text-muted">{t('sceneCount', { count: l.scenes })}</p>
                </div>
              </Link>
            ))}
            {canManage && !showArchived && !needle && (
              <button
                type="button"
                onClick={() => setDialog('location')}
                className="flex min-h-72 flex-col items-center justify-center gap-2 rounded-[22px] border-[1.5px] border-dashed border-line text-muted transition-colors hover:text-foreground"
              >
                <Plus size={26} strokeWidth={1.75} aria-hidden="true" />
                {t('locationNew')}
                <span className="text-xs">{t('locationNewHint')}</span>
              </button>
            )}
          </div>
          {archived.length > 0 && (
            <button
              type="button"
              onClick={() => setShowArchived((v) => !v)}
              className="mt-6 text-sm text-muted hover:text-foreground"
            >
              {showArchived
                ? t('showActive')
                : t('showArchivedLocations', { count: archived.length })}
            </button>
          )}
        </>
      )}

      {dialog === 'location' && base && (
        <LocationDialog
          base={base}
          onClose={() => setDialog(null)}
          onSaved={(id) => router.push(`/scenes/${id}`)}
        />
      )}
      {dialog === 'pc' && workspace && (
        <PcDialog workspaceId={workspace.id} onClose={() => setDialog(null)} />
      )}
      {dialog === 'rules' && base && <RulesDialog base={base} onClose={() => setDialog(null)} />}
    </>
  );
}
