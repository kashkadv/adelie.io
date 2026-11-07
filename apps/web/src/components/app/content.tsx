'use client';

import {
  ArrowDown,
  Download,
  ExternalLink,
  Images,
  Play,
  RefreshCw,
  Search,
  X,
} from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { downloadCsv, toCsv } from '@/lib/csv';
import { Checkbox } from '../ui/checkbox';
import {
  DateRangeChip,
  PeriodControl,
  resolveRange,
  type DateRange,
  type RangeLabels,
} from '../ui/date-range';
import { FilterChip } from '../ui/filter-chip';
import { InfoTip } from '../ui/info-tip';
import { Segmented } from '../ui/segmented';
import { useProjectAccounts, type SocialAccount } from './accounts-data';
import { EmptyState, PageHeader } from './page-header';
import { useWorkspace } from './workspace-context';

type Platform = SocialAccount['platform'];
type MetricKey =
  | 'impressions'
  | 'saves'
  | 'pinClicks'
  | 'outboundClicks'
  | 'videoViews'
  | 'views'
  | 'reach'
  | 'likes'
  | 'comments'
  | 'shares';
type Metrics = Partial<Record<MetricKey, number | null>>;
/** Metrics that can be a table column (video views go to the CSV only). */
type ColumnKey = Exclude<MetricKey, 'videoViews'>;
type Post = {
  id: string;
  url: string | null;
  title: string | null;
  description: string | null;
  thumbnailUrl: string | null;
  contentType: 'IMAGE' | 'VIDEO' | 'CAROUSEL' | 'PRODUCT' | 'OTHER';
  isOwn: boolean;
  publishedAt: string | null;
  board: { id: string; name: string } | null;
  account: { id: string; username: string | null };
  metrics: Metrics | null;
  dataStatus: string | null;
  asOf: string | null;
};
type Page = {
  total: number;
  page: number;
  pageSize: number;
  /** Metrics period; null = lifetime totals. */
  period: { from: string; to: string; dataFrom: string | null } | null;
  items: Post[];
};
type Board = { id: string; name: string; accountId: string; pinCount: number | null };

/** Metric columns per platform (four fit the table); the publication date always comes last. */
const PLATFORM_METRICS: Record<Platform, ColumnKey[]> = {
  PINTEREST: ['impressions', 'saves', 'pinClicks', 'outboundClicks'],
  INSTAGRAM: ['views', 'reach', 'likes', 'saves'],
  TIKTOK: ['impressions', 'saves', 'pinClicks', 'outboundClicks'],
};
/** Everything a platform reports per post, for the CSV export. */
const CSV_METRICS: Record<Platform, MetricKey[]> = {
  PINTEREST: ['impressions', 'saves', 'pinClicks', 'outboundClicks', 'videoViews'],
  INSTAGRAM: ['views', 'reach', 'likes', 'comments', 'saves', 'shares'],
  TIKTOK: ['impressions', 'saves', 'pinClicks', 'outboundClicks', 'videoViews'],
};
/** Platforms whose posts have daily values (ADR-0013); others show lifetime totals only. */
const HAS_PERIODS: Platform[] = ['PINTEREST'];
type Sort = ColumnKey | 'publishedAt';
const OWNERSHIP = ['own', 'saved', 'all'] as const;
type Ownership = (typeof OWNERSHIP)[number];
const ROW_GRID = 'grid-cols-[repeat(4,minmax(0,1fr))_8rem]';

function PostRow({
  post,
  sort,
  columns,
  selected,
  onSelect,
}: {
  post: Post;
  sort: Sort;
  columns: Sort[];
  selected: boolean;
  onSelect: (selected: boolean) => void;
}) {
  const t = useTranslations('Content');
  const format = useFormatter();
  // Platforms may return whitespace-only titles: treat them as missing.
  const title = post.title?.trim() || post.description?.trim() || t('untitled');
  // Compact date for the column: the year only when it is not the current one.
  const shortDate = (iso: string) => {
    const d = new Date(iso);
    return format.dateTime(d, {
      day: 'numeric',
      month: 'short',
      ...(d.getFullYear() === new Date().getFullYear() ? {} : { year: 'numeric' }),
    });
  };
  return (
    <li
      className={`flex flex-wrap items-center gap-x-6 gap-y-3 px-5 py-3 transition-colors xl:flex-nowrap ${selected ? 'bg-hover' : ''}`}
    >
      <div className="flex min-w-0 flex-1 basis-72 items-center gap-3">
        <Checkbox checked={selected} onChange={onSelect} label={t('select')} />
        <span className="relative h-14 w-14 shrink-0 overflow-hidden rounded-xl bg-hover">
          {post.thumbnailUrl && (
            // External platform image: plain <img>, lazy.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={post.thumbnailUrl}
              alt=""
              loading="lazy"
              className="h-full w-full object-cover"
            />
          )}
          {post.contentType === 'VIDEO' && (
            <span className="absolute right-1 bottom-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/60 text-white">
              <Play size={10} fill="currentColor" aria-hidden="true" />
            </span>
          )}
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-medium" title={title}>
            {title}
          </p>
          <p className="flex min-w-0 items-center gap-2 text-xs text-muted">
            {!post.isOwn && (
              <span className="shrink-0 rounded-full border border-line px-1.5 leading-4">
                {t('savedBadge')}
              </span>
            )}
            <span className="truncate">
              {[post.board?.name, t(`types.${post.contentType}`)].filter(Boolean).join(' · ')}
            </span>
          </p>
        </div>
      </div>

      <dl className={`tabular grid shrink-0 ${ROW_GRID} gap-6 text-right xl:w-[44rem]`}>
        {columns.map((key) => {
          const metric = key === 'publishedAt' ? null : (post.metrics?.[key] ?? null);
          const text =
            key === 'publishedAt'
              ? post.publishedAt
                ? shortDate(post.publishedAt)
                : '—'
              : metric === null
                ? '—'
                : format.number(metric);
          return (
            <div key={key}>
              <dt className="text-[11px] text-muted xl:sr-only">{t(`metrics.${key}`)}</dt>
              <dd
                className={`text-sm whitespace-nowrap ${sort === key ? 'font-semibold' : 'text-muted'}`}
              >
                {text}
              </dd>
            </div>
          );
        })}
      </dl>

      <span className="w-8 shrink-0">
        {post.url && (
          <a
            href={post.url}
            target="_blank"
            rel="noreferrer"
            className="icon-btn h-8 w-8"
            aria-label={t('openOnPlatform')}
            title={t('openOnPlatform')}
          >
            <ExternalLink size={15} aria-hidden="true" />
          </a>
        )}
      </span>
    </li>
  );
}

/**
 * Content page (one platform at a time): posts with metrics for a period or lifetime, filter chips,
 * sorting by column, selection and CSV export.
 */
export function Content() {
  const t = useTranslations('Content');
  const tMetric = useTranslations('MetricHints');
  const format = useFormatter();
  const { workspace, project } = useWorkspace();
  const { accounts: allAccounts } = useProjectAccounts();
  // Disconnected and hidden accounts are left out (their history is kept).
  const accounts = useMemo(
    () => allAccounts?.filter((a) => a.status !== 'REVOKED' && !a.hidden) ?? null,
    [allAccounts],
  );
  const platforms = useMemo(
    () => [...new Set((accounts ?? []).map((a) => a.platform))],
    [accounts],
  );
  const [chosenPlatform, setPlatform] = useState<Platform | null>(null);
  const platform =
    chosenPlatform && platforms.includes(chosenPlatform) ? chosenPlatform : platforms[0];

  const [period, setPeriod] = useState<DateRange>({ preset: '7d' });
  const [published, setPublished] = useState<DateRange>({ preset: 'all' });
  const [accountId, setAccountId] = useState('');
  const [boardId, setBoardId] = useState('');
  const [ownership, setOwnership] = useState<Ownership>('own');
  const [chosenSort, setSort] = useState<Sort>('impressions');
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [boards, setBoards] = useState<Board[]>([]);
  const [data, setData] = useState<Page | null>(null);
  const [extra, setExtra] = useState<Post[]>([]);
  const [loadingMore, setLoadingMore] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const base = workspace && project ? `/workspaces/${workspace.id}/projects/${project.id}` : null;

  const platformAccounts = (accounts ?? []).filter((a) => a.platform === platform);
  const metricColumns = PLATFORM_METRICS[platform ?? 'PINTEREST'];
  const columns: Sort[] = [...metricColumns, 'publishedAt'];
  // A sort column of another platform falls back to this platform's first metric.
  const sort: Sort = columns.includes(chosenSort) ? chosenSort : metricColumns[0]!;
  const hasPeriods = !!platform && HAS_PERIODS.includes(platform);

  useEffect(() => {
    const id = setTimeout(() => setDebounced(search.trim()), 300);
    return () => clearTimeout(id);
  }, [search]);

  useEffect(() => {
    if (!base) return;
    let cancelled = false;
    api<Board[]>(`${base}/boards`).then(
      (b) => !cancelled && setBoards(b),
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [base]);

  const query = useMemo(() => {
    const range = hasPeriods ? resolveRange(period) : null;
    const pub = resolveRange(published);
    return new URLSearchParams({
      sort,
      ownership,
      ...(platform ? { platform } : {}),
      ...(range ?? {}),
      ...(pub ? { publishedFrom: pub.from, publishedTo: pub.to } : {}),
      ...(accountId ? { accountId } : {}),
      ...(boardId ? { boardId } : {}),
      ...(debounced ? { q: debounced } : {}),
    });
  }, [sort, ownership, platform, hasPeriods, period, published, accountId, boardId, debounced]);

  useEffect(() => {
    if (!base || !platform) return;
    let cancelled = false;
    api<Page>(`${base}/content?${query}`).then(
      (p) => {
        if (cancelled) return;
        setData(p);
        setExtra([]);
        setSelected(new Set());
      },
      () => !cancelled && setData({ total: 0, page: 0, pageSize: 50, period: null, items: [] }),
    );
    return () => {
      cancelled = true;
    };
  }, [base, platform, query]);

  async function loadMore() {
    if (!base || !data) return;
    setLoadingMore(true);
    try {
      const next = Math.floor((data.items.length + extra.length) / data.pageSize);
      const p = await api<Page>(`${base}/content?${query}&page=${next}`);
      setExtra((e) => [...e, ...p.items]);
    } finally {
      setLoadingMore(false);
    }
  }

  const items = [...(data?.items ?? []), ...extra];
  const selectedCount = items.filter((p) => selected.has(p.id)).length;
  const allChecked: boolean | 'mixed' =
    selectedCount === 0 ? false : selectedCount === items.length ? true : 'mixed';
  const visibleBoards = boards.filter((b) =>
    accountId ? b.accountId === accountId : platformAccounts.some((a) => a.id === b.accountId),
  );

  const rangeLabels: RangeLabels = {
    all: t('period.all'),
    '7d': t('period.7d'),
    '30d': t('period.30d'),
    '12m': t('period.12m'),
    custom: t('period.custom'),
    previous: t('period.previous'),
    next: t('period.next'),
    clear: t('clearFilter'),
  };
  const publishedLabels: RangeLabels = {
    ...rangeLabels,
    '7d': t('published.7d'),
    '30d': t('published.30d'),
    '12m': t('published.12m'),
  };

  function toggle(id: string, on: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function exportCsv() {
    const rows = items.filter((p) => selected.has(p.id));
    const metricKeys = CSV_METRICS[platform ?? 'PINTEREST'];
    const csv = toCsv([
      [
        t('csv.title'),
        t('csv.description'),
        t('csv.url'),
        t('account'),
        t('board'),
        t('csv.type'),
        t('csv.own'),
        t('metrics.publishedAt'),
        ...metricKeys.map((k) => t(`csv.metrics.${k}`)),
        t('csv.periodFrom'),
        t('csv.periodTo'),
      ],
      ...rows.map((p) => [
        p.title?.trim(),
        p.description?.trim(),
        p.url,
        p.account.username,
        p.board?.name,
        t(`types.${p.contentType}`),
        p.isOwn ? t('csv.yes') : t('csv.no'),
        p.publishedAt?.slice(0, 10),
        ...metricKeys.map((k) => p.metrics?.[k] ?? null),
        data?.period?.from ?? t('csv.lifetime'),
        data?.period?.to ?? p.asOf?.slice(0, 10),
      ]),
    ]);
    const name = (platform ?? 'content').toLowerCase();
    downloadCsv(`adelie-${name}-${new Date().toISOString().slice(0, 10)}.csv`, csv);
  }

  const dataFrom = data?.period?.dataFrom;
  const limitedHistory = !!(data?.period && dataFrom && dataFrom > data.period.from);

  if (accounts && platforms.length === 0) {
    return (
      <>
        <PageHeader title={t('title')} />
        <EmptyState
          icon={<Images size={24} strokeWidth={1.75} aria-hidden="true" />}
          title={t('emptyTitle')}
          text={t('emptyText')}
        />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={t('title')}
        subtitle={
          data ? (
            <span className="flex flex-wrap items-center gap-x-1.5">
              {t('count', { count: data.total })}
              <span aria-hidden="true">·</span>
              {data.period ? t('metricsForPeriod') : t('metricsLifetime')}
              {limitedHistory && (
                <>
                  <span aria-hidden="true">·</span>
                  {t('dataSince', {
                    date: format.dateTime(new Date(`${dataFrom}T00:00:00`), {
                      day: 'numeric',
                      month: 'short',
                    }),
                  })}
                </>
              )}
              <InfoTip
                text={
                  data.period
                    ? t('periodHint')
                    : platform === 'INSTAGRAM'
                      ? t('lifetimeHintInstagram')
                      : t('lifetimeHint')
                }
              />
            </span>
          ) : (
            ' '
          )
        }
        action={
          platform && (
            <Segmented
              value={platform}
              onChange={setPlatform}
              options={platforms.map((p) => ({ value: p, label: t(`platforms.${p}`) }))}
              ariaLabel={t('platform')}
            />
          )
        }
      />

      {/* Toolbar: the data period first (it drives every number), then filter chips, then search. */}
      <div className="animate-rise relative z-20 mb-4 flex flex-wrap items-center gap-2">
        {hasPeriods && (
          <>
            <PeriodControl
              value={period}
              onChange={setPeriod}
              labels={rangeLabels}
              ariaLabel={t('period.label')}
            />
            <span className="mx-1 hidden h-6 w-px bg-line sm:block" aria-hidden="true" />
          </>
        )}
        {platformAccounts.length > 1 && (
          <FilterChip
            label={t('account')}
            value={accountId}
            onChange={(v) => {
              setAccountId(v);
              setBoardId('');
            }}
            options={platformAccounts.map((a) => ({
              value: a.id,
              label: a.displayName || a.username || a.externalId,
            }))}
            clearLabel={t('clearFilter')}
          />
        )}
        {platform === 'PINTEREST' && (
          <FilterChip
            label={t('board')}
            value={boardId}
            onChange={setBoardId}
            options={visibleBoards.map((b) => ({
              value: b.id,
              label: b.name,
              hint: b.pinCount === null ? undefined : String(b.pinCount),
            }))}
            searchable={visibleBoards.length > 8}
            searchPlaceholder={t('searchBoards')}
            clearLabel={t('clearFilter')}
          />
        )}
        <DateRangeChip
          label={t('published.label')}
          value={published}
          onChange={setPublished}
          labels={publishedLabels}
        />
        {platform === 'PINTEREST' && (
          <FilterChip
            label={t('ownershipLabel')}
            value={ownership}
            onChange={(v) => setOwnership(v as Ownership)}
            options={OWNERSHIP.map((o) => ({ value: o, label: t(`ownership.${o}`) }))}
            clearable={false}
          />
        )}
        <span className="xl:hidden">
          <FilterChip
            label={t('sortBy')}
            value={sort}
            onChange={(v) => setSort(v as Sort)}
            options={columns.map((c) => ({ value: c, label: t(`metrics.${c}`) }))}
            clearable={false}
          />
        </span>
        <label className="ml-auto flex h-9 w-full items-center gap-2 rounded-full border border-line px-3.5 text-sm focus-within:border-[var(--field-focus)] sm:w-56">
          <Search size={15} className="shrink-0 text-muted" aria-hidden="true" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('search')}
            aria-label={t('search')}
            className="w-full min-w-0 bg-transparent outline-none placeholder:text-muted"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch('')}
              aria-label={t('clearFilter')}
              className="text-muted hover:text-foreground"
            >
              <X size={14} aria-hidden="true" />
            </button>
          )}
        </label>
      </div>

      {data && items.length === 0 ? (
        <section className="card animate-rise rounded-[24px] px-6 py-14 text-center text-sm text-muted">
          {t('noMatches')}
        </section>
      ) : (
        <section className="card animate-rise rounded-[24px]">
          {/* Column headers (desktop) */}
          <div className="hidden items-center gap-6 border-b border-line p-5 text-xs text-muted xl:flex">
            <span className="flex flex-1 items-center gap-3">
              <Checkbox
                checked={allChecked}
                onChange={(on) => setSelected(on ? new Set(items.map((p) => p.id)) : new Set())}
                label={t('selectAll')}
              />
              <span className="pl-[68px]">{t('pin')}</span>
            </span>
            <span className={`grid w-[44rem] ${ROW_GRID} gap-6 text-right`}>
              {columns.map((key) => (
                <span key={key} className="flex items-center justify-end gap-1.5">
                  <button
                    type="button"
                    onClick={() => setSort(key)}
                    aria-pressed={sort === key}
                    className={`flex items-center gap-1 whitespace-nowrap hover:text-foreground ${sort === key ? 'font-semibold text-foreground' : ''}`}
                  >
                    {sort === key && <ArrowDown size={12} aria-hidden="true" />}
                    {t(`metrics.${key}`)}
                  </button>
                  {key !== 'publishedAt' && <InfoTip text={tMetric(key)} />}
                </span>
              ))}
            </span>
            <span className="w-8" />
          </div>
          {data === null ? (
            <p className="px-5 py-10 text-center text-sm text-muted">…</p>
          ) : (
            <ul className="divide-y divide-line">
              {items.map((post) => (
                <PostRow
                  key={post.id}
                  post={post}
                  sort={sort}
                  columns={columns}
                  selected={selected.has(post.id)}
                  onSelect={(on) => toggle(post.id, on)}
                />
              ))}
            </ul>
          )}
          {data && items.length < data.total && (
            <div className="border-t border-line p-3 text-center">
              <button
                type="button"
                onClick={loadMore}
                disabled={loadingMore}
                className="inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm text-muted hover:bg-hover hover:text-foreground"
              >
                {loadingMore && <RefreshCw size={14} className="animate-spin" aria-hidden="true" />}
                {t('loadMore', { count: data.total - items.length })}
              </button>
            </div>
          )}
        </section>
      )}

      {/* Selection actions float at the bottom of the content panel. */}
      {selectedCount > 0 && (
        <div className="pointer-events-none sticky bottom-4 z-30 mt-4 flex justify-center">
          <div className="glass glass-strong animate-rise pointer-events-auto flex items-center gap-2 rounded-full py-1.5 pr-1.5 pl-5 text-sm shadow-[0_8px_30px_var(--shadow)]">
            <span className="font-medium whitespace-nowrap">
              {t('selected', { count: selectedCount })}
            </span>
            <button
              type="button"
              onClick={exportCsv}
              className="ml-2 inline-flex items-center gap-2 rounded-full bg-accent px-3.5 py-1.5 whitespace-nowrap text-accent-foreground"
            >
              <Download size={14} aria-hidden="true" />
              {t('exportCsv')}
            </button>
            <button
              type="button"
              onClick={() => setSelected(new Set())}
              aria-label={t('clearSelection')}
              title={t('clearSelection')}
              className="flex h-8 w-8 items-center justify-center rounded-full text-muted hover:bg-hover hover:text-foreground"
            >
              <X size={15} aria-hidden="true" />
            </button>
          </div>
        </div>
      )}
    </>
  );
}
