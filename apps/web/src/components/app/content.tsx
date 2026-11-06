'use client';

import { ExternalLink, Images, Play, RefreshCw } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { InfoTip } from '../ui/info-tip';
import { Select } from '../ui/select';
import { useProjectAccounts } from './accounts-data';
import { EmptyState, PageHeader } from './page-header';
import { useWorkspace } from './workspace-context';

type Metrics = {
  impressions: number | null;
  saves: number | null;
  pinClicks: number | null;
  outboundClicks: number | null;
  videoViews: number | null;
};
type Post = {
  id: string;
  url: string | null;
  title: string | null;
  description: string | null;
  thumbnailUrl: string | null;
  contentType: 'IMAGE' | 'VIDEO' | 'CAROUSEL' | 'PRODUCT' | 'OTHER';
  publishedAt: string | null;
  board: { id: string; name: string } | null;
  account: { id: string; username: string | null };
  metrics: Metrics | null;
  dataStatus: string | null;
};
type Page = { total: number; page: number; pageSize: number; items: Post[] };
type Board = { id: string; name: string; accountId: string; pinCount: number | null };

const SORTS = ['impressions', 'saves', 'pinClicks', 'outboundClicks', 'publishedAt'] as const;
type Sort = (typeof SORTS)[number];
/** Metric columns, in display order. */
const COLUMNS = ['impressions', 'saves', 'pinClicks', 'outboundClicks'] as const;

function PostRow({ post, sort }: { post: Post; sort: Sort }) {
  const t = useTranslations('Content');
  const format = useFormatter();
  // Platforms may return whitespace-only titles: treat them as missing.
  const title = post.title?.trim() || post.description?.trim() || t('untitled');
  return (
    <li className="flex flex-wrap items-center gap-x-6 gap-y-3 px-5 py-3 md:flex-nowrap">
      <div className="flex min-w-0 flex-1 basis-72 items-center gap-3">
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
          <p className="truncate text-xs text-muted">
            {[
              post.board?.name,
              post.publishedAt &&
                format.dateTime(new Date(post.publishedAt), { dateStyle: 'medium' }),
              t(`types.${post.contentType}`),
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
        </div>
      </div>

      <dl className="tabular grid shrink-0 grid-cols-4 gap-4 text-right md:w-[26rem]">
        {COLUMNS.map((key) => {
          const value = post.metrics?.[key] ?? null;
          return (
            <div key={key}>
              <dt className="sr-only">{t(`metrics.${key}`)}</dt>
              <dd className={`text-sm ${sort === key ? 'font-semibold' : 'text-muted'}`}>
                {value === null ? '—' : format.number(value)}
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

/** Content page: the project's pins with lifetime metrics, sortable and filterable. */
export function Content() {
  const t = useTranslations('Content');
  const { workspace, project } = useWorkspace();
  const { accounts } = useProjectAccounts();
  const [accountId, setAccountId] = useState('');
  const [boardId, setBoardId] = useState('');
  const [sort, setSort] = useState<Sort>('impressions');
  const [boards, setBoards] = useState<Board[]>([]);
  const [data, setData] = useState<Page | null>(null);
  const [extra, setExtra] = useState<Post[]>([]);
  const [loadingMore, setLoadingMore] = useState(false);
  const base = workspace && project ? `/workspaces/${workspace.id}/projects/${project.id}` : null;

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

  const query = useMemo(
    () =>
      new URLSearchParams({
        sort,
        ...(accountId ? { accountId } : {}),
        ...(boardId ? { boardId } : {}),
      }),
    [sort, accountId, boardId],
  );

  useEffect(() => {
    if (!base) return;
    let cancelled = false;
    api<Page>(`${base}/content?${query}`).then(
      (p) => {
        if (cancelled) return;
        setData(p);
        setExtra([]);
      },
      () => !cancelled && setData({ total: 0, page: 0, pageSize: 50, items: [] }),
    );
    return () => {
      cancelled = true;
    };
  }, [base, query]);

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
  const visibleBoards = accountId ? boards.filter((b) => b.accountId === accountId) : boards;

  return (
    <>
      <PageHeader
        title={t('title')}
        subtitle={
          data ? (
            <span className="flex items-center gap-1.5">
              {t('count', { count: data.total })}
              <InfoTip text={t('lifetimeHint')} />
            </span>
          ) : (
            ' '
          )
        }
        action={
          <div className="flex flex-wrap items-center gap-2">
            {accounts && accounts.length > 1 && (
              <div className="w-52">
                <Select
                  value={accountId}
                  onChange={(v) => {
                    setAccountId(v);
                    setBoardId('');
                  }}
                  options={[
                    { value: '', label: t('allAccounts') },
                    ...accounts.map((a) => ({
                      value: a.id,
                      label: a.displayName || a.username || a.externalId,
                    })),
                  ]}
                  ariaLabel={t('account')}
                />
              </div>
            )}
            <div className="w-52">
              <Select
                value={boardId}
                onChange={setBoardId}
                options={[
                  { value: '', label: t('allBoards') },
                  ...visibleBoards.map((b) => ({
                    value: b.id,
                    label: b.name,
                    hint: b.pinCount === null ? undefined : String(b.pinCount),
                  })),
                ]}
                searchable={visibleBoards.length > 8}
                searchPlaceholder={t('searchBoards')}
                ariaLabel={t('board')}
              />
            </div>
            <div className="w-52">
              <Select
                value={sort}
                onChange={(v) => setSort(v as Sort)}
                options={SORTS.map((s) => ({ value: s, label: t(`sort.${s}`) }))}
                ariaLabel={t('sortBy')}
              />
            </div>
          </div>
        }
      />

      {data && items.length === 0 ? (
        <EmptyState
          icon={<Images size={24} strokeWidth={1.75} aria-hidden="true" />}
          title={t('emptyTitle')}
          text={t('emptyText')}
        />
      ) : (
        <section className="card animate-rise rounded-[24px]">
          {/* Column headers (desktop) */}
          <div className="hidden items-center gap-6 border-b border-line px-5 py-3 text-xs text-muted md:flex">
            <span className="flex-1 pl-[68px]">{t('pin')}</span>
            <span className="grid w-[26rem] grid-cols-4 gap-4 text-right">
              {COLUMNS.map((key) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setSort(key)}
                  className={`text-right whitespace-nowrap hover:text-foreground ${sort === key ? 'font-semibold text-foreground' : ''}`}
                >
                  {t(`metrics.${key}`)}
                </button>
              ))}
            </span>
            <span className="w-8" />
          </div>
          {data === null ? (
            <p className="px-5 py-10 text-center text-sm text-muted">…</p>
          ) : (
            <ul className="divide-y divide-line">
              {items.map((post) => (
                <PostRow key={post.id} post={post} sort={sort} />
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
    </>
  );
}
