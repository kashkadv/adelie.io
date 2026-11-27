'use client';

import {
  Archive,
  ArchiveRestore,
  Brush,
  Check,
  ChevronLeft,
  PencilLine,
  Plus,
  RefreshCw,
  Sparkles,
  Star,
  Trash2,
  X,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { apiUrl } from '@/lib/auth-client';
import { CONNECT_ROLES } from './accounts-data';
import { GpuPill } from './scenes';
import { AreaRefine } from './scene-area-refine';
import { SceneSketches } from './scene-sketches';
import { AddScenesDialog, LocationDialog, RefineDialog, SceneViewer } from './scenes-dialogs';
import { TABS, type LocationDetail, type Scene } from './scenes-data';
import { useWorkspace } from './workspace-context';

type Tab = (typeof TABS)[number];

/**
 * One location of the Workshop's scenes (ADR-0042): its kept scenes by scene type, the new ones grouped by the request
 * that made them (keep / reject / more like this, several at once, keyboard), and the archive.
 */
export function SceneLocation({ locationId }: { locationId: string }) {
  const t = useTranslations('Scenes');
  const router = useRouter();
  const { workspace, project } = useWorkspace();
  const canManage = !!workspace && CONNECT_ROLES.includes(workspace.role);
  const base = workspace && project ? `/workspaces/${workspace.id}/projects/${project.id}` : null;

  const [data, setData] = useState<LocationDetail | null>(null);
  // when the data came: the estimate of the time left is counted from it (no clock read while rendering)
  const [loadedAt, setLoadedAt] = useState(0);
  const [missing, setMissing] = useState(false);
  const [version, setVersion] = useState(0);
  const [tab, setTab] = useState<Tab | null>(null);
  const [type, setType] = useState<string | null>(null);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [focus, setFocus] = useState(0);
  const [viewer, setViewer] = useState<number | null>(null);
  const [dialog, setDialog] = useState<'edit' | 'add' | null>(null);
  const [useSketch, setUseSketch] = useState<string | null>(null);
  const [refining, setRefining] = useState<Scene | null>(null);
  const [area, setArea] = useState<Scene | null>(null);
  const reload = () => setVersion((v) => v + 1);

  useEffect(() => {
    if (!base) return;
    let cancelled = false;
    const load = () =>
      api<LocationDetail>(`${base}/scene-locations/${locationId}`).then(
        (r) => {
          if (cancelled) return;
          setData(r);
          setLoadedAt(Date.now());
        },
        () => !cancelled && setMissing(true),
      );
    void load();
    const timer = setInterval(() => document.visibilityState === 'visible' && void load(), 10_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [base, locationId, version]);

  const scenes = useMemo(() => data?.scenes ?? [], [data]);
  const count = (s: Tab) =>
    s === 'sketches' ? (data?.sketches?.length ?? 0) : scenes.filter((x) => x.status === s).length;
  // Opens on "New" while something waits for a decision, else on the kept scenes.
  const current: Tab = tab ?? (data && count('candidate') > 0 ? 'candidate' : 'library');
  const typeLabel = useCallback(
    (key: string | null) =>
      (key && data?.allTypes.find((x) => x.key === key)?.label) || t('sceneTypeUnknown'),
    [data, t],
  );
  const inTab = scenes.filter(
    (s) => s.status === current && (current === 'candidate' || !type || s.sceneType === type),
  );
  const typesHere = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of scenes.filter((x) => x.status === current)) {
      const k = s.sceneType ?? '';
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return [...m];
  }, [scenes, current]);

  // New scenes as one grid (owner, 2026-11-27): the newest request first, its scenes in their order, so the versions of
  // one request stay side by side. Scenes still being made come first, as placeholders.
  const fresh = useMemo(() => {
    const items = scenes.filter((x) => x.status === 'candidate');
    const started = new Map<string, number>();
    for (const s of items) {
      const k = s.jobId ?? s.id;
      const at = new Date(s.createdAt).getTime();
      started.set(k, Math.min(started.get(k) ?? at, at));
    }
    const key = (s: Scene) => started.get(s.jobId ?? s.id) ?? 0;
    return items.sort((a, b) => key(b) - key(a) || a.number - b.number);
  }, [scenes]);
  const pending = useMemo(
    () =>
      (data?.jobs ?? [])
        .filter((j) => j.status === 'queued' || j.status === 'running')
        .flatMap((j) => {
          const made = scenes.filter((x) => x.jobId === j.id).length;
          return Array.from(
            { length: Math.max(0, (j.params.count ?? 0) - made) },
            (_, i) => `${j.id}-${i}`,
          );
        }),
    [scenes, data],
  );
  const flat = current === 'candidate' ? fresh : inTab;

  const look = (s: Scene) =>
    [
      s.light && t(`lights.${s.light}` as 'lights.sun'),
      s.angle && t(`angles.${s.angle}` as 'angles.front'),
      s.sizeClass && t(`sizes.${s.sizeClass}` as 'sizes.small'),
    ]
      .filter(Boolean)
      .join(' · ');
  const src = (s: Scene) => (base && s.assetId ? `${apiUrl}${base}/assets/${s.assetId}` : '');

  const patch = async (s: Scene, json: Record<string, unknown>) => {
    if (!base) return;
    setData(
      (d) => d && { ...d, scenes: d.scenes.map((x) => (x.id === s.id ? { ...x, ...json } : x)) },
    );
    await api(`${base}/scenes/${s.id}`, { method: 'PATCH', json }).catch(() => undefined);
    reload();
  };
  const keep = (s: Scene) => patch(s, { status: 'library' });
  const reject = (s: Scene) => patch(s, { status: 'rejected' });
  const more = async (s: Scene) => {
    if (!base) return;
    await api(`${base}/scenes/${s.id}/more`, { method: 'POST', json: { count: 4 } }).catch(
      () => undefined,
    );
    setTab('candidate');
    reload();
  };
  const remove = async (s: Scene) => {
    if (!base) return;
    await api(`${base}/scenes/${s.id}`, { method: 'DELETE' }).catch(() => undefined);
    setViewer(null);
    reload();
  };
  const setCover = async (s: Scene) => {
    if (!base || !data) return;
    await api(`${base}/scene-locations/${locationId}`, {
      method: 'PATCH',
      json: { coverSceneId: s.id },
    }).catch(() => undefined);
    reload();
  };
  /** The chosen new scenes, kept or rejected at once. */
  const decideChosen = async (status: 'library' | 'rejected') => {
    if (!base) return;
    const ids = fresh.filter((s) => chosen.has(s.id)).map((s) => s.id);
    const keepIds = status === 'library' ? ids : [];
    const rejectIds = status === 'rejected' ? ids : [];
    setData(
      (d) =>
        d && {
          ...d,
          scenes: d.scenes.map((x) =>
            keepIds.includes(x.id)
              ? { ...x, status: 'library' }
              : rejectIds.includes(x.id)
                ? { ...x, status: 'rejected' }
                : x,
          ),
        },
    );
    await api(`${base}/scenes/decide`, {
      method: 'POST',
      json: { keep: keepIds, reject: rejectIds },
    }).catch(() => undefined);
    setChosen(new Set());
    reload();
  };
  const toggle = (s: Scene) =>
    setChosen((c) => {
      const n = new Set(c);
      if (n.has(s.id)) n.delete(s.id);
      else n.add(s.id);
      return n;
    });
  const cancelJob = async (id: string) => {
    if (!base) return;
    await api(`${base}/gpu-jobs/${id}/cancel`, { method: 'POST' }).catch(() => undefined);
    reload();
  };
  const archiveLocation = async (archived: boolean) => {
    if (!base) return;
    await api(`${base}/scene-locations/${locationId}`, {
      method: 'PATCH',
      json: { archived },
    }).catch(() => undefined);
    if (archived) router.push('/scenes');
    else reload();
  };

  // Keyboard on "New": ←/→ move, Enter keep, X reject, Space choose.
  useEffect(() => {
    if (current !== 'candidate' || viewer !== null || dialog || !canManage) return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable))
        return;
      const s = flat[focus];
      if (e.key === 'ArrowRight') setFocus((i) => Math.min(flat.length - 1, i + 1));
      else if (e.key === 'ArrowLeft') setFocus((i) => Math.max(0, i - 1));
      else if (!s) return;
      else if (e.key === 'Enter') void keep(s);
      else if (e.key === 'x' || e.key === 'X' || e.key === 'Delete') void reject(s);
      else if (e.key === ' ') toggle(s);
      else return;
      e.preventDefault();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- handlers read the latest state
  }, [current, viewer, dialog, canManage, flat, focus]);

  if (missing) {
    return (
      <p className="py-10 text-center text-sm text-muted">
        {t('locationMissing')}{' '}
        <Link href="/scenes" className="underline">
          {t('backToScenes')}
        </Link>
      </p>
    );
  }
  if (!data) return <p className="py-10 text-center text-sm text-muted">…</p>;

  const loc = data.location;
  const active = data.jobs.filter((j) => j.status === 'queued' || j.status === 'running');
  const failed = data.jobs.filter((j) => j.status === 'failed');
  const viewed = viewer !== null ? flat[viewer] : undefined;
  const jobTitle = (j: LocationDetail['jobs'][number]) =>
    j.kind === 'scene_refine'
      ? t(j.params.maskAssetId ? 'areaJob' : 'refineJob', {
          n: j.params.parentNumber ?? '',
          what: j.params.instruction ?? '',
        })
      : [
          j.params.sceneTypeLabel ?? typeLabel(j.params.sceneType ?? null),
          j.params.light && t(`lights.${j.params.light}` as 'lights.sun'),
          j.params.angle && t(`angles.${j.params.angle}` as 'angles.front'),
          j.params.sizeClass && t(`sizes.${j.params.sizeClass}` as 'sizes.small'),
        ]
          .filter(Boolean)
          .join(' · ');

  /** "Generating scene 2 of 4 · 45% · ~3 min": the stage the PC reports, the estimate from the time so far. */
  const jobLine = (j: LocationDetail['jobs'][number]) => {
    const total = j.params.count ?? 1;
    const n = Math.min(total, Math.floor((j.progress / 100) * total) + 1);
    const stage =
      j.stage === 'mockup'
        ? t('stages.mockup')
        : j.stage === 'describing'
          ? t('stages.describing')
          : j.stage === 'refining'
            ? t('stages.refining')
            : j.stage === 'loading'
              ? t('stages.loading')
              : j.stage === 'uploading' || j.stage === 'saved'
                ? t('stages.uploading')
                : t('stages.generating', { n, total });
    const started = j.claimedAt ? new Date(j.claimedAt).getTime() : 0;
    const left =
      started && j.progress >= 5
        ? ((loadedAt - started) * (100 - j.progress)) / j.progress / 60_000
        : null;
    return [
      stage,
      `${j.progress}%`,
      left !== null &&
        (left < 1 ? t('etaUnderMinute') : t('etaMinutes', { count: Math.round(left) })),
    ]
      .filter(Boolean)
      .join(' · ');
  };

  /** Under a new scene: the request that made it - the refine instruction, or how it was asked for. */
  const caption = (s: Scene) => {
    const p = s.params as { instruction?: string; area?: boolean };
    return p.instruction
      ? `${t(p.area ? 'area' : 'refine')}: ${p.instruction}`
      : [look(s), s.style].filter(Boolean).join(' · ');
  };

  const placeholder = (key: string) => (
    <div key={key} className="card overflow-hidden rounded-[20px]" aria-hidden="true">
      <div className="relative aspect-[2/3] animate-pulse bg-hover">
        <span className="absolute inset-0 flex items-center justify-center text-muted">
          <RefreshCw size={22} className="animate-spin" />
        </span>
      </div>
      <div className="px-3 pt-2.5 pb-3">
        <span className="block h-3.5 w-2/3 rounded bg-hover" />
        <span className="mt-1.5 block h-3 w-1/2 rounded bg-hover" />
      </div>
    </div>
  );

  const card = (s: Scene, i: number, candidate: boolean) => {
    const picked = chosen.has(s.id);
    return (
      <article
        key={s.id}
        className={`group card overflow-hidden rounded-[20px] border-2 transition-colors ${
          candidate && picked
            ? 'border-accent'
            : candidate && focus === i
              ? 'border-[var(--field-focus)]'
              : 'border-transparent'
        }`}
      >
        <div className="relative">
          <button
            type="button"
            className="block w-full"
            onClick={() => {
              setFocus(i);
              setViewer(i);
            }}
            aria-label={t('open')}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- served by the API with the session cookie */}
            <img src={src(s)} alt="" loading="lazy" className="aspect-[2/3] w-full object-cover" />
          </button>
          {candidate && (
            <span className="absolute top-2.5 left-2.5 flex h-7 min-w-7 items-center justify-center rounded-full bg-black/60 px-2 text-sm font-semibold text-white">
              {s.number}
            </span>
          )}
          {!candidate && loc.coverSceneId === s.id && (
            <span className="absolute top-2.5 left-2.5 rounded-full bg-white/90 px-2 py-0.5 text-xs font-semibold text-black">
              {t('cover')}
            </span>
          )}
          {candidate && canManage && (
            <button
              type="button"
              onClick={() => toggle(s)}
              aria-pressed={picked}
              aria-label={t('choose')}
              className={`absolute top-2.5 right-2.5 flex h-8 w-8 items-center justify-center rounded-full border-2 border-white text-white ${
                picked ? 'bg-accent' : 'bg-black/25'
              }`}
            >
              <Check size={15} strokeWidth={3} aria-hidden="true" />
            </button>
          )}
          {candidate && canManage && (
            <div className="absolute inset-x-2.5 bottom-2.5 flex gap-1.5 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
              <button
                type="button"
                onClick={() => void keep(s)}
                className="h-8 flex-1 rounded-xl bg-white/95 text-xs font-semibold text-black"
              >
                {t('keep')}
              </button>
              <button
                type="button"
                onClick={() => void reject(s)}
                aria-label={t('reject')}
                title={t('reject')}
                className="flex h-8 w-8 items-center justify-center rounded-xl bg-white/95 text-black"
              >
                <X size={14} aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={() => setRefining(s)}
                aria-label={t('refine')}
                title={t('refine')}
                className="flex h-8 w-8 items-center justify-center rounded-xl bg-white/95 text-black"
              >
                <PencilLine size={14} aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={() => void more(s)}
                aria-label={t('more')}
                title={t('more')}
                className="flex h-8 w-8 items-center justify-center rounded-xl bg-white/95 text-black"
              >
                <Sparkles size={14} aria-hidden="true" />
              </button>
            </div>
          )}
        </div>
        <div className="px-3 pt-2.5 pb-3">
          <p className="truncate text-sm font-semibold">{typeLabel(s.sceneType)}</p>
          <p className="truncate text-xs text-muted" title={candidate ? caption(s) : undefined}>
            {candidate ? caption(s) : look(s)}
          </p>
        </div>
      </article>
    );
  };

  return (
    <>
      <Link
        href="/scenes"
        className="animate-rise inline-flex items-center gap-1 text-sm text-muted hover:text-foreground"
      >
        <ChevronLeft size={15} aria-hidden="true" />
        {t('title')}
      </Link>
      <header className="animate-rise relative z-10 mt-2 mb-5 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-[1_1_420px]">
          <h1 className="text-2xl leading-tight font-semibold md:text-[28px]">{loc.name}</h1>
          {(loc.description || loc.mustHave) && (
            <details className="mt-1 text-sm text-muted">
              <summary className="cursor-pointer truncate marker:content-none">
                {loc.description || loc.mustHave}
              </summary>
              {loc.mustHave && (
                <p className="mt-2">
                  <span className="font-medium text-foreground">{t('mustHave')}:</span>{' '}
                  {loc.mustHave}
                </p>
              )}
            </details>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <GpuPill gpu={data.gpu} />
          {canManage && (
            <button
              type="button"
              onClick={() => setDialog('edit')}
              className="h-10 rounded-2xl border border-line px-3.5 text-sm text-muted hover:text-foreground"
            >
              {t('locationEditShort')}
            </button>
          )}
          {canManage && (
            <button
              type="button"
              onClick={() => setDialog('add')}
              className="btn-primary flex w-auto items-center gap-2 px-4"
            >
              <Plus size={16} aria-hidden="true" />
              {t('addScenes')}
            </button>
          )}
        </div>
      </header>

      {(active.length > 0 || failed.length > 0) && (
        <section className="card animate-rise mb-4 grid gap-2 rounded-[22px] p-4">
          {active.map((j) => (
            <div key={j.id} className="flex items-center gap-3 text-sm">
              <RefreshCw
                size={15}
                className={j.status === 'running' ? 'animate-spin text-accent' : 'text-muted'}
                aria-hidden="true"
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate">
                  {jobTitle(j)} · {t('scenesN', { count: j.params.count ?? 0 })}
                </span>
                {j.status === 'running' && (
                  <span className="mt-1.5 block h-1 overflow-hidden rounded-full bg-hover">
                    <span
                      className="block h-full rounded-full bg-accent transition-[width] duration-700"
                      style={{ width: `${Math.max(2, j.progress)}%` }}
                    />
                  </span>
                )}
              </span>
              <span className="shrink-0 text-right text-muted">
                {j.status === 'running'
                  ? jobLine(j)
                  : data.gpu.state === 'ready'
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
          {failed.map((j) => (
            <p key={j.id} className="text-sm text-rose-600 dark:text-rose-400">
              {t('jobFailed', { what: jobTitle(j) })}
              {j.error ? ` — ${j.error.slice(0, 160)}` : ''}
            </p>
          ))}
        </section>
      )}

      <div className="animate-rise mb-7 flex flex-wrap items-center justify-between gap-3">
        <div
          role="tablist"
          aria-label={t('view')}
          className="inline-flex gap-1 rounded-2xl bg-hover p-1"
        >
          {TABS.map((v) => (
            <button
              key={v}
              type="button"
              role="tab"
              aria-selected={current === v}
              onClick={() => {
                setTab(v);
                setType(null);
                setFocus(0);
              }}
              className={`h-9 rounded-xl px-3.5 text-sm transition-colors ${
                current === v
                  ? 'bg-[var(--panel)] font-medium shadow-sm'
                  : 'text-muted hover:text-foreground'
              }`}
            >
              {t(`tabs.${v}`)}
              {v !== 'archived' && count(v) > 0 ? ` · ${count(v)}` : ''}
            </button>
          ))}
        </div>
        {current !== 'candidate' && current !== 'sketches' && typesHere.length > 1 && (
          <div className="flex flex-wrap gap-1.5 text-sm">
            {[[null, inTab.length] as const, ...typesHere].map(([k, n]) => (
              <button
                key={k ?? 'all'}
                type="button"
                aria-pressed={(k || null) === type}
                onClick={() => setType(k || null)}
                className={`rounded-full border px-3 py-1.5 ${
                  (k || null) === type
                    ? 'border-accent bg-accent text-accent-foreground'
                    : 'border-line text-muted hover:text-foreground'
                }`}
              >
                {k === null ? t('allTypes') : typeLabel(k)}{' '}
                {k !== null && <span className="opacity-70">{n}</span>}
              </button>
            ))}
          </div>
        )}
      </div>

      {current === 'sketches' ? (
        base && (
          <SceneSketches
            base={base}
            locationId={locationId}
            sketches={data.sketches ?? []}
            sceneTypes={data.sceneTypes}
            typeLabel={typeLabel}
            canManage={canManage}
            onChanged={reload}
            onUse={(id) => {
              setUseSketch(id);
              setDialog('add');
            }}
          />
        )
      ) : current === 'candidate' ? (
        fresh.length === 0 && pending.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted">{t('noNew')}</p>
        ) : (
          <div className="animate-rise grid gap-4">
            <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
              {pending.map((k) => placeholder(k))}
              {fresh.map((s, i) => card(s, i, true))}
            </div>
            {canManage && <p className="text-xs text-muted">{t('keysHint')}</p>}
            {canManage && chosen.size > 0 && (
              <div className="sticky bottom-4 z-10 flex justify-center">
                <div className="glass glass-strong flex flex-wrap items-center gap-2 rounded-2xl p-2 pl-4 shadow-lg">
                  <span className="text-sm font-medium">
                    {t('chosenN', { count: chosen.size })}
                  </span>
                  <button
                    type="button"
                    onClick={() => void decideChosen('library')}
                    className="btn-primary flex h-9 w-auto items-center gap-1.5 px-3.5 text-sm"
                  >
                    <Check size={15} aria-hidden="true" />
                    {t('keepSelected')}
                  </button>
                  <button
                    type="button"
                    onClick={() => void decideChosen('rejected')}
                    className="flex h-9 items-center gap-1.5 rounded-xl border border-line px-3.5 text-sm text-muted hover:text-foreground"
                  >
                    <X size={15} aria-hidden="true" />
                    {t('rejectSelected')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setChosen(new Set())}
                    className="h-9 rounded-xl px-3 text-sm text-muted hover:bg-hover hover:text-foreground"
                  >
                    {t('clearChosen')}
                  </button>
                </div>
              </div>
            )}
          </div>
        )
      ) : inTab.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted">
          {current === 'library' ? t('noScenes') : t('noArchived')}
        </p>
      ) : (
        <div className="animate-rise grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
          {inTab.map((s, i) => card(s, i, false))}
        </div>
      )}

      {canManage && (
        <div className="mt-10 flex flex-wrap gap-4 text-sm text-muted">
          <button
            type="button"
            className="hover:text-foreground"
            onClick={() => void archiveLocation(!loc.archivedAt)}
          >
            {loc.archivedAt ? t('locationRestore') : t('locationArchive')}
          </button>
        </div>
      )}

      {viewed && !area && (
        <SceneViewer
          src={src(viewed)}
          title={`${typeLabel(viewed.sceneType)}${viewed.status === 'candidate' ? ` · №${viewed.number}` : ''}`}
          details={[look(viewed), viewed.style].filter(Boolean).join(' · ')}
          position={`${(viewer ?? 0) + 1} / ${flat.length}`}
          onPrev={viewer! > 0 ? () => setViewer((v) => (v ?? 1) - 1) : undefined}
          onNext={viewer! < flat.length - 1 ? () => setViewer((v) => (v ?? 0) + 1) : undefined}
          onClose={() => setViewer(null)}
          actions={
            canManage && (
              <>
                {viewed.status === 'candidate' && (
                  <>
                    <button
                      type="button"
                      onClick={() => void keep(viewed)}
                      className="flex h-10 items-center gap-1.5 rounded-xl bg-white px-4 text-sm font-semibold text-black"
                    >
                      <Check size={15} aria-hidden="true" />
                      {t('keep')}
                    </button>
                    <button
                      type="button"
                      onClick={() => void reject(viewed)}
                      className="flex h-10 items-center gap-1.5 rounded-xl bg-white/15 px-4 text-sm text-white"
                    >
                      <X size={15} aria-hidden="true" />
                      {t('reject')}
                    </button>
                  </>
                )}
                {viewed.status === 'library' && (
                  <>
                    <button
                      type="button"
                      onClick={() => void setCover(viewed)}
                      className="flex h-10 items-center gap-1.5 rounded-xl bg-white/15 px-4 text-sm text-white"
                    >
                      <Star size={15} aria-hidden="true" />
                      {t('makeCover')}
                    </button>
                    <button
                      type="button"
                      onClick={() => void patch(viewed, { status: 'archived' })}
                      className="flex h-10 items-center gap-1.5 rounded-xl bg-white/15 px-4 text-sm text-white"
                    >
                      <Archive size={15} aria-hidden="true" />
                      {t('archive')}
                    </button>
                  </>
                )}
                {viewed.status === 'archived' && (
                  <button
                    type="button"
                    onClick={() => void patch(viewed, { status: 'library' })}
                    className="flex h-10 items-center gap-1.5 rounded-xl bg-white/15 px-4 text-sm text-white"
                  >
                    <ArchiveRestore size={15} aria-hidden="true" />
                    {t('restore')}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setRefining(viewed)}
                  className="flex h-10 items-center gap-1.5 rounded-xl bg-white/15 px-4 text-sm text-white"
                >
                  <PencilLine size={15} aria-hidden="true" />
                  {t('refine')}
                </button>
                <button
                  type="button"
                  onClick={() => setArea(viewed)}
                  className="flex h-10 items-center gap-1.5 rounded-xl bg-white/15 px-4 text-sm text-white"
                >
                  <Brush size={15} aria-hidden="true" />
                  {t('area')}
                </button>
                <button
                  type="button"
                  onClick={() => void more(viewed)}
                  className="flex h-10 items-center gap-1.5 rounded-xl bg-white/15 px-4 text-sm text-white"
                >
                  <Sparkles size={15} aria-hidden="true" />
                  {t('more')}
                </button>
                <button
                  type="button"
                  onClick={() => void remove(viewed)}
                  className="flex h-10 items-center gap-1.5 rounded-xl px-4 text-sm text-white/70 hover:text-white"
                >
                  <Trash2 size={15} aria-hidden="true" />
                  {t('delete')}
                </button>
              </>
            )
          }
        />
      )}

      {dialog === 'edit' && base && (
        <LocationDialog
          base={base}
          location={loc}
          onClose={() => setDialog(null)}
          onSaved={() => {
            setDialog(null);
            reload();
          }}
        />
      )}
      {refining && base && (
        <RefineDialog
          base={base}
          sceneId={refining.id}
          title={`${typeLabel(refining.sceneType)}${refining.status === 'candidate' ? ` №${refining.number}` : ''}`}
          onClose={() => setRefining(null)}
          onQueued={() => {
            setRefining(null);
            setViewer(null);
            setTab('candidate');
            reload();
          }}
        />
      )}
      {area && base && (
        <AreaRefine
          base={base}
          sceneId={area.id}
          src={src(area)}
          title={`${typeLabel(area.sceneType)}${area.status === 'candidate' ? ` №${area.number}` : ''}`}
          onClose={() => setArea(null)}
          onQueued={() => {
            setArea(null);
            setViewer(null);
            setTab('candidate');
            reload();
          }}
        />
      )}
      {dialog === 'add' && base && (
        <AddScenesDialog
          base={base}
          locationId={locationId}
          sceneTypes={data.sceneTypes}
          sketches={data.sketches ?? []}
          typeLabel={typeLabel}
          initialSketchId={useSketch}
          gpu={data.gpu.state}
          onClose={() => {
            setDialog(null);
            setUseSketch(null);
          }}
          onQueued={() => {
            setDialog(null);
            setTab('candidate');
            reload();
          }}
        />
      )}
    </>
  );
}
