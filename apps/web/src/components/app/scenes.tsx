'use client';

import {
  Archive,
  ArchiveRestore,
  Check,
  Cpu,
  Images,
  Pencil,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { apiUrl } from '@/lib/auth-client';
import { InfoTip } from '../ui/info-tip';
import { Segmented } from '../ui/segmented';
import { CONNECT_ROLES } from './accounts-data';
import { EmptyState, PageHeader } from './page-header';
import { GenerateDialog, LocationDialog, PcDialog, SceneViewer } from './scenes-dialogs';
import {
  STATUS_VIEWS,
  type GpuState,
  type Scene,
  type SceneLocation,
  type ScenesData,
} from './scenes-data';
import { useWorkspace } from './workspace-context';

const GPU_DOT: Record<GpuState, string> = {
  ready: 'bg-emerald-500',
  busy: 'bg-amber-400',
  offline: 'bg-zinc-400',
};

/**
 * Scenes of the Workshop (ADR-0042): the project's locations — like real photoshoot locations — and the rooms in
 * them that products are later placed into. New candidates are generated on the owner's PC; the owner chooses which
 * go into the library.
 */
export function Scenes() {
  const t = useTranslations('Scenes');
  const format = useFormatter();
  const { workspace, project } = useWorkspace();
  const canManage = !!workspace && CONNECT_ROLES.includes(workspace.role);
  const base = workspace && project ? `/workspaces/${workspace.id}/projects/${project.id}` : null;

  const [data, setData] = useState<ScenesData | null>(null);
  const [version, setVersion] = useState(0);
  const [locationId, setLocationId] = useState<string | null>(null);
  const [view, setView] = useState<(typeof STATUS_VIEWS)[number]>('library');
  const [dialog, setDialog] = useState<
    | { kind: 'location'; location?: SceneLocation }
    | { kind: 'generate' }
    | { kind: 'pc' }
    | { kind: 'scene'; scene: Scene }
    | null
  >(null);

  const reload = () => setVersion((v) => v + 1);

  useEffect(() => {
    if (!base) return;
    let cancelled = false;
    const load = () =>
      api<ScenesData>(`${base}/scenes`).then(
        (r) => !cancelled && setData(r),
        () =>
          !cancelled &&
          setData(
            (d) =>
              d ?? { locations: [], scenes: [], jobs: [], gpu: { state: 'offline', workers: 0 } },
          ),
      );
    void load();
    // While the PC works, the page follows its progress.
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, 10_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [base, version]);

  const locations = data?.locations ?? [];
  const current = locations.find((l) => l.id === locationId) ?? null;
  const scenes = (data?.scenes ?? []).filter(
    (s) => s.status === view && (!locationId || s.locationId === locationId),
  );
  const activeJobs = (data?.jobs ?? []).filter(
    (j) => j.status === 'queued' || j.status === 'running',
  );
  const failedJobs = (data?.jobs ?? []).filter((j) => j.status === 'failed');
  const gpu = data?.gpu ?? { state: 'offline' as GpuState, workers: 0 };
  const src = (s: Scene) => (base && s.assetId ? `${apiUrl}${base}/assets/${s.assetId}` : '');
  const locationName = (id: string) => locations.find((l) => l.id === id)?.name ?? '';
  const countOf = (l: SceneLocation) => (l.counts.library ?? 0) + (l.counts.candidate ?? 0);

  async function setStatus(scene: Scene, status: Scene['status']) {
    if (!base) return;
    // Optimistic: the card leaves the current view at once.
    setData(
      (d) => d && { ...d, scenes: d.scenes.map((s) => (s.id === scene.id ? { ...s, status } : s)) },
    );
    await api(`${base}/scenes/${scene.id}`, { method: 'PATCH', json: { status } }).catch(
      () => undefined,
    );
    reload();
  }

  async function more(scene: Scene) {
    if (!base) return;
    await api(`${base}/scenes/${scene.id}/more`, { method: 'POST', json: { count: 4 } }).catch(
      () => undefined,
    );
    reload();
  }

  async function remove(scene: Scene) {
    if (!base) return;
    await api(`${base}/scenes/${scene.id}`, { method: 'DELETE' }).catch(() => undefined);
    setDialog(null);
    reload();
  }

  async function cancelJob(id: string) {
    if (!base) return;
    await api(`${base}/gpu-jobs/${id}/cancel`, { method: 'POST' }).catch(() => undefined);
    reload();
  }

  const sceneLabel = (s: Scene) =>
    [
      s.light && t(`lights.${s.light}` as 'lights.sun'),
      s.angle && t(`angles.${s.angle}` as 'angles.front'),
      s.sizeClass && t(`sizes.${s.sizeClass}` as 'sizes.small'),
    ]
      .filter(Boolean)
      .join(' · ');

  const gpuPill = (
    <span className="flex h-10 items-center gap-2 rounded-2xl border border-line px-3 text-sm text-muted">
      <span className={`h-2.5 w-2.5 rounded-full ${GPU_DOT[gpu.state]}`} aria-hidden="true" />
      {t(`gpu.${gpu.state}`)}
      <InfoTip text={gpu.workers ? t(`gpuHint.${gpu.state}`) : t('gpuHint.none')} />
    </span>
  );

  return (
    <>
      <PageHeader
        title={t('title')}
        subtitle={t('subtitle')}
        action={
          <div className="flex flex-wrap items-center gap-2">
            {gpuPill}
            {canManage && (
              <button
                type="button"
                onClick={() => setDialog({ kind: 'pc' })}
                className="icon-btn h-10 w-10"
                title={t('pcTitle')}
                aria-label={t('pcTitle')}
              >
                <Cpu size={17} aria-hidden="true" />
              </button>
            )}
            {canManage && locations.length > 0 && (
              <button
                type="button"
                onClick={() => setDialog({ kind: 'generate' })}
                className="btn-primary flex w-auto items-center gap-2 px-4"
              >
                <Sparkles size={16} aria-hidden="true" />
                {t('generate')}
              </button>
            )}
          </div>
        }
      />

      {!data ? (
        <p className="py-10 text-center text-sm text-muted">…</p>
      ) : locations.length === 0 ? (
        <EmptyState
          icon={<Images size={22} strokeWidth={1.75} aria-hidden="true" />}
          title={t('emptyTitle')}
          text={t('emptyText')}
          action={
            canManage ? (
              <button
                type="button"
                onClick={() => setDialog({ kind: 'location' })}
                className="btn-primary w-auto px-5"
              >
                {t('locationNew')}
              </button>
            ) : undefined
          }
        />
      ) : (
        <>
          {/* Locations: like photoshoot locations; "All" shows every one. */}
          <div className="animate-rise mb-4 flex flex-wrap items-center gap-2">
            {[null, ...locations].map((l) => {
              const on = (l?.id ?? null) === locationId;
              return (
                <button
                  key={l?.id ?? 'all'}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setLocationId(l?.id ?? null)}
                  className={`flex h-10 items-center gap-2 rounded-2xl px-4 text-sm transition-colors ${
                    on
                      ? 'bg-accent font-medium text-accent-foreground'
                      : 'border border-line text-muted hover:text-foreground'
                  }`}
                >
                  {l ? l.name : t('allLocations')}
                  {l && <span className="tabular text-xs opacity-70">{countOf(l)}</span>}
                </button>
              );
            })}
            {canManage && (
              <button
                type="button"
                onClick={() => setDialog({ kind: 'location' })}
                className="icon-btn h-10 w-10"
                title={t('locationNew')}
                aria-label={t('locationNew')}
              >
                <Plus size={17} aria-hidden="true" />
              </button>
            )}
          </div>

          {current && (
            <div className="animate-rise mb-4 flex items-start gap-2 px-1 text-sm text-muted">
              <p className="min-w-0 flex-1">
                {t(`kinds.${current.kind}`)}
                {current.description ? ` · ${current.description}` : ''}
              </p>
              {canManage && (
                <button
                  type="button"
                  onClick={() => setDialog({ kind: 'location', location: current })}
                  className="icon-btn h-8 w-8"
                  title={t('locationEdit')}
                  aria-label={t('locationEdit')}
                >
                  <Pencil size={14} aria-hidden="true" />
                </button>
              )}
            </div>
          )}

          {(activeJobs.length > 0 || failedJobs.length > 0) && (
            <section className="card animate-rise mb-4 grid gap-2 rounded-[24px] p-4">
              {activeJobs.map((j) => (
                <div key={j.id} className="flex items-center gap-3 text-sm">
                  <RefreshCw
                    size={15}
                    className={j.status === 'running' ? 'animate-spin text-accent' : 'text-muted'}
                    aria-hidden="true"
                  />
                  <span className="min-w-0 flex-1 truncate">
                    {t('jobLine', {
                      count: j.params.count ?? 0,
                      location: j.params.location?.name ?? '',
                    })}
                  </span>
                  <span className="text-muted">
                    {j.status === 'running'
                      ? t('jobRunning', { progress: j.progress })
                      : gpu.state === 'ready'
                        ? t('jobQueued')
                        : t('jobWaitingPc')}
                  </span>
                  {j.status === 'queued' && canManage && (
                    <button
                      type="button"
                      onClick={() => void cancelJob(j.id)}
                      className="icon-btn h-8 w-8"
                      title={t('jobCancel')}
                      aria-label={t('jobCancel')}
                    >
                      <X size={14} aria-hidden="true" />
                    </button>
                  )}
                </div>
              ))}
              {failedJobs.map((j) => (
                <p key={j.id} className="text-sm text-rose-600 dark:text-rose-400">
                  {t('jobFailed', { location: j.params.location?.name ?? '' })}
                  {j.error ? ` — ${j.error.slice(0, 160)}` : ''}
                </p>
              ))}
            </section>
          )}

          <div className="animate-rise mb-4">
            <Segmented
              ariaLabel={t('view')}
              value={view}
              onChange={setView}
              options={STATUS_VIEWS.map((v) => ({
                value: v,
                label: t(`views.${v}`),
              }))}
            />
          </div>

          {scenes.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted">
              {view === 'candidate'
                ? t('noCandidates')
                : view === 'library'
                  ? t('noLibrary')
                  : t('noArchived')}
            </p>
          ) : (
            <div className="animate-rise grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
              {scenes.map((s) => (
                <article key={s.id} className="card overflow-hidden rounded-[22px]">
                  <button
                    type="button"
                    className="relative block w-full"
                    onClick={() => setDialog({ kind: 'scene', scene: s })}
                    aria-label={t('open')}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element -- served by the API with the session cookie */}
                    <img
                      src={src(s)}
                      alt={s.name ?? locationName(s.locationId)}
                      loading="lazy"
                      className="aspect-[2/3] w-full object-cover"
                    />
                    {s.status === 'candidate' && (
                      <span className="absolute top-2 left-2 flex h-7 min-w-7 items-center justify-center rounded-full bg-black/60 px-2 text-sm font-semibold text-white">
                        {s.number}
                      </span>
                    )}
                  </button>
                  <div className="grid gap-2 p-3">
                    <p className="truncate text-sm font-medium">
                      {s.name ?? locationName(s.locationId)}
                    </p>
                    <p className="truncate text-xs text-muted">{sceneLabel(s)}</p>
                    {canManage && (
                      <div className="flex items-center gap-1.5">
                        {s.status === 'candidate' && (
                          <>
                            <button
                              type="button"
                              onClick={() => void setStatus(s, 'library')}
                              className="btn-primary flex h-8 w-auto flex-1 items-center justify-center gap-1.5 px-2 text-xs"
                            >
                              <Check size={14} aria-hidden="true" />
                              {t('toLibrary')}
                            </button>
                            <button
                              type="button"
                              onClick={() => void setStatus(s, 'rejected')}
                              className="icon-btn h-8 w-8"
                              title={t('reject')}
                              aria-label={t('reject')}
                            >
                              <X size={14} aria-hidden="true" />
                            </button>
                          </>
                        )}
                        {s.status === 'library' && (
                          <button
                            type="button"
                            onClick={() => void setStatus(s, 'archived')}
                            className="icon-btn h-8 w-8"
                            title={t('archive')}
                            aria-label={t('archive')}
                          >
                            <Archive size={14} aria-hidden="true" />
                          </button>
                        )}
                        {s.status === 'archived' && (
                          <button
                            type="button"
                            onClick={() => void setStatus(s, 'library')}
                            className="icon-btn h-8 w-8"
                            title={t('restore')}
                            aria-label={t('restore')}
                          >
                            <ArchiveRestore size={14} aria-hidden="true" />
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => void more(s)}
                          className="icon-btn h-8 w-8"
                          title={t('more')}
                          aria-label={t('more')}
                        >
                          <Sparkles size={14} aria-hidden="true" />
                        </button>
                      </div>
                    )}
                  </div>
                </article>
              ))}
            </div>
          )}
        </>
      )}

      {dialog?.kind === 'location' && base && (
        <LocationDialog
          base={base}
          location={dialog.location}
          onClose={() => setDialog(null)}
          onSaved={() => {
            setDialog(null);
            reload();
          }}
        />
      )}
      {dialog?.kind === 'generate' && base && (
        <GenerateDialog
          base={base}
          locations={locations}
          locationId={locationId}
          onClose={() => setDialog(null)}
          onQueued={() => {
            setDialog(null);
            setView('candidate');
            reload();
          }}
        />
      )}
      {dialog?.kind === 'pc' && workspace && (
        <PcDialog workspaceId={workspace.id} onClose={() => setDialog(null)} />
      )}
      {dialog?.kind === 'scene' && (
        <SceneViewer
          src={src(dialog.scene)}
          title={`${locationName(dialog.scene.locationId)}${
            dialog.scene.status === 'candidate' ? ` · №${dialog.scene.number}` : ''
          }`}
          details={[
            [t('details.look'), sceneLabel(dialog.scene) || '—'],
            [t('details.style'), dialog.scene.style || '—'],
            [
              t('details.products'),
              dialog.scene.productTypes.map((p) => t(`types.${p}` as 'types.rug')).join(', ') ||
                '—',
            ],
            [
              t('details.sizes'),
              dialog.scene.minCm && dialog.scene.maxCm
                ? t('details.sizesValue', { min: dialog.scene.minCm, max: dialog.scene.maxCm })
                : '—',
            ],
            [t('details.model'), String(dialog.scene.params['model'] ?? '—')],
            [
              t('details.created'),
              format.dateTime(new Date(dialog.scene.createdAt), { dateStyle: 'medium' }),
            ],
          ]}
          actions={
            canManage && (
              <>
                <button
                  type="button"
                  onClick={() => void remove(dialog.scene)}
                  className="flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-sm text-muted hover:bg-hover hover:text-foreground"
                >
                  <Trash2 size={14} aria-hidden="true" />
                  {t('delete')}
                </button>
                {dialog.scene.status === 'candidate' && (
                  <button
                    type="button"
                    onClick={() => {
                      void setStatus(dialog.scene, 'library');
                      setDialog(null);
                    }}
                    className="btn-primary w-auto px-5"
                  >
                    {t('toLibrary')}
                  </button>
                )}
              </>
            )
          }
          onClose={() => setDialog(null)}
        />
      )}
    </>
  );
}
