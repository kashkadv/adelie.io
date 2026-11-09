'use client';

import {
  ArrowDown,
  Download,
  ExternalLink,
  Images,
  Play,
  RefreshCw,
  Search,
  Store,
  X,
} from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { usePathname, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
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
import { ColumnPicker } from './column-picker';
import { PostDialog } from './post-dialog';
import { usePreferences } from './preferences';
import { useWorkspace } from './workspace-context';

type Platform = Exclude<SocialAccount['platform'], 'ETSY'>;
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
/** A table column: a metric or the publication date. */
type Column = MetricKey | 'publishedAt';
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
  account: { id: string; username: string | null; platform: Platform };
  metrics: Metrics | null;
  dataStatus: string | null;
  asOf: string | null;
  /** The shop product the post leads to (ADR-0018). */
  linkedProduct: { id: string; title: string; imageUrl: string | null } | null;
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

/**
 * Every column a platform offers, in the default order (the same lists the API validates,
 * apps/api/src/preferences/preferences.ts). The CSV "all metrics" export uses them too.
 */
const ALL_COLUMNS: Record<Platform, Column[]> = {
  PINTEREST: ['impressions', 'saves', 'pinClicks', 'outboundClicks', 'videoViews', 'publishedAt'],
  INSTAGRAM: ['views', 'reach', 'likes', 'comments', 'saves', 'shares', 'publishedAt'],
  TIKTOK: ['impressions', 'saves', 'pinClicks', 'outboundClicks', 'videoViews', 'publishedAt'],
};
/** Shown until the person picks their own (Content → Columns). */
const DEFAULT_COLUMNS: Record<Platform, Column[]> = {
  PINTEREST: ['impressions', 'saves', 'pinClicks', 'outboundClicks', 'publishedAt'],
  INSTAGRAM: ['views', 'reach', 'likes', 'saves', 'publishedAt'],
  TIKTOK: ['impressions', 'saves', 'pinClicks', 'outboundClicks', 'publishedAt'],
};
/** Daily post values exist only for these (ADR-0013): others show "—" for a period. */
const PERIOD_METRICS: Record<Platform, Column[]> = {
  PINTEREST: ['impressions', 'saves', 'pinClicks', 'outboundClicks'],
  // From the day-to-day change of lifetime totals (ADR-0017).
  INSTAGRAM: ['views', 'reach', 'likes', 'comments', 'saves', 'shares'],
  TIKTOK: [],
};
/** Platforms whose posts have daily values; others show lifetime totals only. */
const HAS_PERIODS: Platform[] = ['PINTEREST', 'INSTAGRAM'];
type Sort = Column;
const OWNERSHIP = ['own', 'saved', 'all'] as const;
type Ownership = (typeof OWNERSHIP)[number];
type Filters = {
  period: DateRange;
  published: DateRange;
  accountId: string;
  boardId: string;
  ownership: Ownership;
  sort: Sort;
  search: string;
  /** Where posts lead: '' = anywhere. */
  leads: '' | Leads;
};
const LEADS = ['product', 'site', 'none'] as const;
type Leads = (typeof LEADS)[number];
const DEFAULT_FILTERS: Filters = {
  period: { preset: '7d' },
  published: { preset: 'all' },
  accountId: '',
  boardId: '',
  ownership: 'own',
  // Newest first by default: the freshest posts are what people check most.
  sort: 'publishedAt',
  search: '',
  leads: '',
};
const columnsKey = (platform: Platform) => `content.columns.${platform}`;

/** The saved choice, if it is still valid for the platform (columns may change between versions). */
function savedColumns(value: unknown, platform: Platform): Column[] | null {
  const list = (value as { columns?: unknown } | undefined)?.columns;
  if (!Array.isArray(list)) return null;
  const known = list.filter((c): c is Column => ALL_COLUMNS[platform].includes(c as Column));
  return known.length ? known : null;
}

/**
 * Column grid shared by the header and the rows: metrics share the space, the date is fixed. The
 * width grows with the number of columns (metrics get narrower when there are many).
 */
function columnGrid(columns: Column[]) {
  const metrics = columns.filter((c) => c !== 'publishedAt').length;
  const metricRem = metrics > 5 ? 6 : 7.5;
  const width = metrics * metricRem + (columns.length - metrics) * 8 + (columns.length - 1) * 1.5;
  return {
    '--cols': columns.map((c) => (c === 'publishedAt' ? '8rem' : 'minmax(0,1fr)')).join(' '),
    '--table-w': `${width}rem`,
  } as CSSProperties;
}

function PostRow({
  post,
  sort,
  columns,
  selected,
  onSelect,
  onOpen,
}: {
  post: Post;
  sort: Sort;
  columns: Column[];
  selected: boolean;
  onSelect: (selected: boolean) => void;
  onOpen: () => void;
}) {
  const kind = post.account.platform === 'PINTEREST' ? 'pin' : 'post';
  const t = useTranslations('Content');
  const format = useFormatter();
  // Platforms may return whitespace-only titles: treat them as missing.
  const title = post.title?.trim() || post.description?.trim() || t('untitled', { kind });
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
        <Checkbox checked={selected} onChange={onSelect} label={t('select', { kind })} />
        {/* The post itself opens its card (all metrics, daily dynamics). */}
        <button
          type="button"
          onClick={onOpen}
          aria-haspopup="dialog"
          className="group flex min-w-0 flex-1 items-center gap-3 rounded-xl text-left"
        >
          <span className="relative h-14 w-14 shrink-0 overflow-hidden rounded-xl bg-hover transition-transform duration-200 group-hover:scale-[1.04]">
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
            <p
              className="truncate text-sm font-medium group-hover:underline group-hover:underline-offset-2"
              title={title}
            >
              {title}
            </p>
            <p className="flex min-w-0 items-center gap-2 text-xs text-muted">
              {!post.isOwn && (
                <span className="shrink-0 rounded-full border border-line px-1.5 leading-4">
                  {t('savedBadge')}
                </span>
              )}
              {post.linkedProduct && (
                <span
                  className="flex min-w-0 shrink items-center gap-1 rounded-full bg-hover py-px pr-2 pl-px text-foreground"
                  title={t('leads.toProduct', { title: post.linkedProduct.title })}
                >
                  {post.linkedProduct.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={post.linkedProduct.imageUrl}
                      alt=""
                      className="h-4 w-4 shrink-0 rounded-full object-cover"
                    />
                  ) : (
                    <Store size={11} className="ml-1 shrink-0" aria-hidden="true" />
                  )}
                  <span className="max-w-40 truncate">{post.linkedProduct.title}</span>
                </span>
              )}
              <span className="truncate">
                {[post.board?.name, t(`types.${post.contentType}`)].filter(Boolean).join(' · ')}
              </span>
            </p>
          </div>
        </button>
      </div>

      <dl
        style={columnGrid(columns)}
        className="tabular grid shrink-0 grid-cols-3 gap-x-6 gap-y-2 text-right sm:grid-cols-4 md:grid-cols-5 xl:w-(--table-w) xl:[grid-template-columns:var(--cols)]"
      >
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
            aria-label={t('openOnPlatform', { platform: t(`platforms.${post.account.platform}`) })}
            title={t('openOnPlatform', { platform: t(`platforms.${post.account.platform}`) })}
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
  // Points of sale have no posts (ADR-0018): their data lives in Sales.
  const platforms = useMemo(
    () =>
      [...new Set((accounts ?? []).map((a) => a.platform))].filter(
        (p): p is Platform => p in ALL_COLUMNS,
      ),
    [accounts],
  );
  // A link from elsewhere (a product card) can name a platform and a post to open.
  const urlParams = useSearchParams();
  const pathname = usePathname();
  const [chosenPlatform, setPlatform] = useState<Platform | null>(() => {
    const wanted = urlParams.get('platform');
    return wanted && wanted in ALL_COLUMNS ? (wanted as Platform) : null;
  });
  const platform =
    chosenPlatform && platforms.includes(chosenPlatform) ? chosenPlatform : platforms[0];

  // Each platform keeps its own filters: switching tabs neither carries a Pinterest account or
  // board over to Instagram nor loses them on the way back. Not remembered across reloads.
  const [filtersBy, setFiltersBy] = useState<Partial<Record<Platform, Filters>>>({});
  const filters = (platform && filtersBy[platform]) || DEFAULT_FILTERS;
  const { period, published, accountId, boardId, ownership, search, leads } = filters;
  const chosenSort = filters.sort;
  const setFilter = <F extends keyof Filters>(key: F, value: Filters[F]) => {
    if (!platform) return;
    setFiltersBy((all) => ({
      ...all,
      [platform]: { ...(all[platform] ?? DEFAULT_FILTERS), [key]: value },
    }));
  };
  const setPeriod = (v: DateRange) => setFilter('period', v);
  const setPublished = (v: DateRange) => setFilter('published', v);
  const setAccountId = (v: string) => setFilter('accountId', v);
  const setBoardId = (v: string) => setFilter('boardId', v);
  const setOwnership = (v: Ownership) => setFilter('ownership', v);
  const setSort = (v: Sort) => setFilter('sort', v);
  const setSearch = (v: string) => setFilter('search', v);
  const setLeads = (v: '' | Leads) => setFilter('leads', v);
  const [openId, setOpenId] = useState<string | null>(() => urlParams.get('post'));
  // The search sent to the API, a moment after typing stops; another platform's is never used.
  const [typed, setTyped] = useState<{ platform?: Platform; q: string }>({ q: '' });
  const debounced = typed.platform === platform ? typed.q : search.trim();
  const [boards, setBoards] = useState<Board[]>([]);
  const [data, setData] = useState<Page | null>(null);
  const [extra, setExtra] = useState<Post[]>([]);
  const [loadingMore, setLoadingMore] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [csvAll, setCsvAll] = useState(false);
  const { prefs, setPreference } = usePreferences();
  const prefsReady = prefs !== null;
  const base = workspace && project ? `/workspaces/${workspace.id}/projects/${project.id}` : null;

  const platformAccounts = (accounts ?? []).filter((a) => a.platform === platform);
  const columnsPlatform = platform ?? 'PINTEREST';
  const saved = prefs ? savedColumns(prefs[columnsKey(columnsPlatform)], columnsPlatform) : null;
  const columns = saved ?? DEFAULT_COLUMNS[columnsPlatform];
  const hasPeriods = !!platform && HAS_PERIODS.includes(platform);
  const periodActive = hasPeriods && resolveRange(period) !== null;
  /** Lifetime-only metrics cannot rank posts by a period. */
  const sortable = (c: Column) =>
    !periodActive || c === 'publishedAt' || PERIOD_METRICS[columnsPlatform].includes(c);
  // A sort column that is hidden, of another platform or not sortable now falls back to the first
  // sortable column shown (or the publication date).
  const sort: Sort =
    columns.includes(chosenSort) && sortable(chosenSort)
      ? chosenSort
      : (columns.find(sortable) ?? 'publishedAt');
  /** Pinterest calls its posts pins; every other platform — posts. */
  const kind = platform === 'PINTEREST' ? 'pin' : 'post';

  useEffect(() => {
    const id = setTimeout(() => setTyped({ platform, q: search.trim() }), 300);
    return () => clearTimeout(id);
  }, [search, platform]);

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

  // A plain string: effects re-run only when the request really changes.
  const range = hasPeriods ? resolveRange(period) : null;
  const pub = resolveRange(published);
  const query = new URLSearchParams({
    sort,
    ownership,
    ...(platform ? { platform } : {}),
    ...(range ?? {}),
    ...(pub ? { publishedFrom: pub.from, publishedTo: pub.to } : {}),
    ...(accountId ? { accountId } : {}),
    ...(boardId ? { boardId } : {}),
    ...(debounced ? { q: debounced } : {}),
    ...(leads ? { leads } : {}),
  }).toString();

  useEffect(() => {
    // Wait for the settings: they decide the columns, and so the sort.
    if (!base || !platform || !prefsReady) return;
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
  }, [base, platform, query, prefsReady]);

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
  const openIndex = openId ? items.findIndex((p) => p.id === openId) : -1;
  const closePost = useCallback(() => {
    setOpenId(null);
    // The link that opened the post is spent: a reload must not open it again.
    if (window.location.search) window.history.replaceState(null, '', pathname);
  }, [pathname]);
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
    // What is shown, in its order — or every metric the platform has.
    const fields = csvAll ? ALL_COLUMNS[columnsPlatform] : columns;
    const label = (c: Column) =>
      c === 'publishedAt' ? t('metrics.publishedAt') : t(`csv.metrics.${c}`);
    const value = (p: Post, c: Column) =>
      c === 'publishedAt' ? p.publishedAt?.slice(0, 10) : (p.metrics?.[c] ?? null);
    const csv = toCsv([
      [
        t('csv.title'),
        t('csv.description'),
        t('csv.url'),
        t('account'),
        t('board'),
        t('csv.type'),
        t('csv.own'),
        ...fields.map(label),
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
        ...fields.map((c) => value(p, c)),
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
              {t('count', { count: data.total, kind })}
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
                    ? platform === 'INSTAGRAM'
                      ? t('periodHintInstagram')
                      : t('periodHint')
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
            label={t('leads.label')}
            value={leads}
            onChange={(v) => setLeads(v as '' | Leads)}
            options={LEADS.map((l) => ({ value: l, label: t(`leads.${l}`) }))}
            clearLabel={t('clearFilter')}
          />
        )}
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
            options={columns.filter(sortable).map((c) => ({ value: c, label: t(`metrics.${c}`) }))}
            clearable={false}
          />
        </span>
        {platform && (
          <ColumnPicker
            // A fresh panel per platform: its order state belongs to one platform's columns.
            key={platform}
            all={ALL_COLUMNS[platform]}
            value={columns}
            labels={
              Object.fromEntries(
                ALL_COLUMNS[platform].map((c) => [
                  c,
                  c === 'publishedAt' ? t('metrics.publishedAt') : t(`csv.metrics.${c}`),
                ]),
              ) as Record<Column, string>
            }
            isDefault={!saved}
            onChange={(next) => setPreference(columnsKey(platform), { columns: next })}
            onReset={() => setPreference(columnsKey(platform), null)}
          />
        )}
        <label className="ml-auto flex h-9 w-full items-center gap-2 rounded-full border border-line px-3.5 text-sm focus-within:border-[var(--field-focus)] sm:w-56">
          <Search size={15} className="shrink-0 text-muted" aria-hidden="true" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('search', { kind })}
            aria-label={t('search', { kind })}
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
          {t('noMatches', { kind })}
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
              <span className="pl-[68px]">{t('pin', { kind })}</span>
            </span>
            <span
              style={columnGrid(columns)}
              className="grid w-(--table-w) [grid-template-columns:var(--cols)] gap-6 text-right"
            >
              {columns.map((key) => (
                <span key={key} className="flex min-w-0 items-center justify-end gap-1.5">
                  {sortable(key) ? (
                    <button
                      type="button"
                      onClick={() => setSort(key)}
                      aria-pressed={sort === key}
                      className={`flex min-w-0 items-center gap-1 whitespace-nowrap hover:text-foreground ${sort === key ? 'font-semibold text-foreground' : ''}`}
                    >
                      {sort === key && <ArrowDown size={12} aria-hidden="true" />}
                      <span className="truncate">{t(`metrics.${key}`)}</span>
                    </button>
                  ) : (
                    <span className="truncate whitespace-nowrap">{t(`metrics.${key}`)}</span>
                  )}
                  {key !== 'publishedAt' && (
                    <InfoTip
                      text={
                        periodActive && !sortable(key)
                          ? `${tMetric(key)} ${t('lifetimeOnly')}`
                          : tMetric(key)
                      }
                    />
                  )}
                </span>
              ))}
            </span>
            <span className="w-8" />
          </div>
          {data === null || !prefsReady ? (
            <p className="px-5 py-10 text-center text-sm text-muted">…</p>
          ) : (
            <ul className="divide-y divide-line">
              {items.map((post) => (
                <PostRow
                  key={post.id}
                  post={post}
                  sort={sort}
                  columns={columns}
                  onOpen={() => setOpenId(post.id)}
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
              {t('selected', { count: selectedCount, kind })}
            </span>
            <span className="ml-2 flex items-center gap-2 pl-2">
              <Checkbox checked={csvAll} onChange={setCsvAll} label={t('csvAll')} />
              <button
                type="button"
                onClick={() => setCsvAll(!csvAll)}
                className="whitespace-nowrap text-muted hover:text-foreground"
              >
                {t('csvAll')}
              </button>
              <InfoTip text={t('csvAllHint')} />
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

      {openId && base && (
        <PostDialog
          base={base}
          postId={openId}
          onClose={closePost}
          onPrevious={openIndex > 0 ? () => setOpenId(items[openIndex - 1]!.id) : undefined}
          onNext={
            openIndex >= 0 && openIndex < items.length - 1
              ? () => setOpenId(items[openIndex + 1]!.id)
              : undefined
          }
        />
      )}
    </>
  );
}
