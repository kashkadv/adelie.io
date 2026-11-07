import {
  BadRequestException,
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Prisma } from '@adelie/db';
import { PrismaService } from '../prisma.service.js';
import {
  PERIOD_METRICS as PERIOD_SORTS,
  periodMetrics,
  sortByPeriod,
  type PeriodMetric,
  type PeriodValues,
} from './period.js';
import { visibleProjectsWhere } from '../workspaces/project-visibility.js';
import {
  WorkspaceAccessGuard,
  type WorkspaceRequestContext,
} from '../workspaces/workspace-access.guard.js';

/** Sortable columns: lifetime metrics from PostMetricsLatest, or the publication date. */
const SORTS = [
  'impressions',
  'saves',
  'pinClicks',
  'outboundClicks',
  'videoViews',
  // Instagram (lifetime only: Meta gives no daily values per post).
  'views',
  'reach',
  'likes',
  'comments',
  'shares',
  'publishedAt',
] as const;
type Sort = (typeof SORTS)[number];
const PAGE_SIZE = 50;
const PLATFORMS = ['PINTEREST', 'INSTAGRAM', 'TIKTOK'] as const;
type Platform = (typeof PLATFORMS)[number];
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;
const asDate = (d: string) => new Date(`${d}T00:00:00Z`);
const day = (d: Date) => d.toISOString().slice(0, 10);
/** Our post metric keys (metric_definition.key) → response field. */
const METRIC_KEYS: Record<string, PeriodMetric> = {
  impressions: 'impressions',
  saves: 'saves',
  pin_clicks: 'pinClicks',
  outbound_clicks: 'outboundClicks',
};

const POST_SELECT = {
  id: true,
  externalId: true,
  url: true,
  title: true,
  description: true,
  thumbnailUrl: true,
  contentType: true,
  isOwn: true,
  publishedAt: true,
  dailyTo: true,
  board: { select: { id: true, name: true } },
  account: { select: { id: true, username: true, platform: true } },
  latest: {
    select: {
      impressions: true,
      saves: true,
      pinClicks: true,
      outboundClicks: true,
      videoViews: true,
      views: true,
      reach: true,
      likes: true,
      comments: true,
      shares: true,
      dataStatus: true,
      asOfDate: true,
    },
  },
} satisfies Prisma.SocialPostSelect;

/**
 * Project content (pins) with their latest lifetime metrics (ADR-0008: the derived
 * PostMetricsLatest table exists exactly for sorting and top lists). Posts without metrics are
 * listed too and always sort last — missing data is never treated as zero.
 */
@Controller('workspaces/:workspaceId/projects/:projectId')
@UseGuards(WorkspaceAccessGuard)
export class ContentController {
  constructor(private readonly prisma: PrismaService) {}

  private async visibleProject(ctx: WorkspaceRequestContext, projectId: string) {
    const project = await this.prisma.client.project.findFirst({
      where: { id: projectId, ...visibleProjectsWhere(ctx) },
      select: { id: true },
    });
    if (!project) throw new NotFoundException();
  }

  @Get('content')
  async list(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Query() query: Record<string, string | undefined>,
    @Req() request: { workspace: WorkspaceRequestContext },
  ) {
    await this.visibleProject(request.workspace, projectId);
    const sort = (query['sort'] ?? 'publishedAt') as Sort;
    if (!SORTS.includes(sort)) throw new BadRequestException('Unknown sort');
    const page = Math.max(0, Number(query['page'] ?? 0) || 0);
    const platform = query['platform'] ?? 'PINTEREST';
    if (!PLATFORMS.includes(platform as Platform))
      throw new BadRequestException('Unknown platform');

    // Own posts by default: posts saved from other accounts carry no metrics (Pinterest repins).
    const ownership = query['ownership'] ?? 'own';
    if (!['own', 'saved', 'all'].includes(ownership))
      throw new BadRequestException('Unknown ownership');

    // Dates are inclusive calendar days (UTC): `from`/`to` = metrics period (none = lifetime),
    // `publishedFrom`/`publishedTo` = publication date filter.
    for (const key of ['from', 'to', 'publishedFrom', 'publishedTo']) {
      const v = query[key];
      if (v && !DAY.test(v)) throw new BadRequestException('Dates must be YYYY-MM-DD');
    }
    const { from, to, publishedFrom, publishedTo } = query;
    if (!!from !== !!to) throw new BadRequestException('Period needs both from and to');
    const publishedAt =
      publishedFrom || publishedTo
        ? {
            ...(publishedFrom ? { gte: asDate(publishedFrom) } : {}),
            ...(publishedTo ? { lt: new Date(asDate(publishedTo).getTime() + DAY_MS) } : {}),
          }
        : undefined;
    const search = query['q']?.trim();

    const where: Prisma.SocialPostWhereInput = {
      projectId,
      workspaceId: request.workspace.workspaceId,
      ...(publishedAt ? { publishedAt } : {}),
      ...(ownership === 'all' ? {} : { isOwn: ownership === 'own' }),
      ...(query['accountId'] ? { accountId: query['accountId'] } : {}),
      // Disconnected and hidden accounts are left out: their history is kept.
      account: {
        platform: platform as Platform,
        hiddenAt: null,
        connection: { status: { not: 'REVOKED' } },
      },
      ...(query['boardId'] ? { boardId: query['boardId'] } : {}),
      ...(search
        ? {
            OR: [
              { title: { contains: search, mode: 'insensitive' } },
              { description: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    // Period sums need daily post values (ADR-0013) — Instagram has lifetime totals only.
    if (from && to && platform !== 'INSTAGRAM') {
      return this.listForPeriod(where, { from, to, sort, page });
    }

    const orderBy: Prisma.SocialPostOrderByWithRelationInput[] =
      sort === 'publishedAt'
        ? [{ publishedAt: { sort: 'desc', nulls: 'last' } }, { id: 'asc' }]
        : [
            { latest: { [sort]: { sort: 'desc', nulls: 'last' } } },
            { publishedAt: { sort: 'desc', nulls: 'last' } },
            { id: 'asc' },
          ];

    const [total, posts] = await Promise.all([
      this.prisma.client.socialPost.count({ where }),
      this.prisma.client.socialPost.findMany({
        where,
        orderBy,
        skip: page * PAGE_SIZE,
        take: PAGE_SIZE,
        select: POST_SELECT,
      }),
    ]);

    return {
      total,
      page,
      pageSize: PAGE_SIZE,
      period: null,
      items: posts.map(({ latest, ...p }) => ({
        ...p,
        metrics: latest
          ? {
              impressions: latest.impressions,
              saves: latest.saves,
              pinClicks: latest.pinClicks,
              outboundClicks: latest.outboundClicks,
              videoViews: latest.videoViews,
              views: latest.views,
              reach: latest.reach,
              likes: latest.likes,
              comments: latest.comments,
              shares: latest.shares,
            }
          : null,
        partial: false,
        dataStatus: latest?.dataStatus ?? null,
        asOf: latest?.asOfDate ?? null,
      })),
    };
  }

  /**
   * Metrics summed over a period from daily values (ADR-0013). Sorting by a sum cannot be pushed
   * into the posts query, so the matching posts are ranked in memory — fine for a project's few
   * thousand posts; a materialized rollup comes when that stops being true.
   */
  private async listForPeriod(
    where: Prisma.SocialPostWhereInput,
    opts: { from: string; to: string; sort: Sort; page: number },
  ) {
    const db = this.prisma.client;
    const all = await db.socialPost.findMany({
      where,
      select: { id: true, accountId: true, publishedAt: true, dailyFrom: true, dailyTo: true },
    });
    const posts = all.map((p) => ({
      id: p.id,
      publishedAt: p.publishedAt ? day(p.publishedAt) : null,
      dailyFrom: p.dailyFrom ? day(p.dailyFrom) : null,
      dailyTo: p.dailyTo ? day(p.dailyTo) : null,
    }));

    const definitions = await db.metricDefinition.findMany({
      where: { scope: 'POST', key: { in: Object.keys(METRIC_KEYS) } },
      select: { id: true, key: true },
    });
    const metricOf = new Map(definitions.map((d) => [d.id, METRIC_KEYS[d.key]!]));
    const grouped = all.length
      ? await db.postMetricDaily.groupBy({
          by: ['postId', 'metricId'],
          where: {
            accountId: { in: [...new Set(all.map((p) => p.accountId))] },
            metricId: { in: definitions.map((d) => d.id) },
            date: { gte: asDate(opts.from), lte: asDate(opts.to) },
          },
          _sum: { value: true },
        })
      : [];
    const sums = new Map<string, Partial<PeriodValues>>();
    for (const g of grouped) {
      const metric = metricOf.get(g.metricId);
      if (!metric) continue;
      const entry = sums.get(g.postId) ?? {};
      entry[metric] = Math.round(g._sum.value ?? 0);
      sums.set(g.postId, entry);
    }
    const values = periodMetrics(posts, sums, opts.from);

    const ordered = (PERIOD_SORTS as readonly string[]).includes(opts.sort)
      ? sortByPeriod(posts, values, opts.sort as PeriodMetric)
      : sortByPeriod(posts, new Map(), 'impressions');
    const pageIds = ordered
      .slice(opts.page * PAGE_SIZE, (opts.page + 1) * PAGE_SIZE)
      .map((p) => p.id);
    const rows = await db.socialPost.findMany({
      where: { id: { in: pageIds } },
      select: POST_SELECT,
    });
    const byId = new Map(rows.map((r) => [r.id, r]));
    const coverage = posts.map((p) => p.dailyFrom).filter((d): d is string => !!d);

    return {
      total: posts.length,
      page: opts.page,
      pageSize: PAGE_SIZE,
      period: {
        from: opts.from,
        to: opts.to,
        // Earliest day with daily data among these posts: the UI says "data since …".
        dataFrom: coverage.length ? coverage.reduce((a, b) => (a < b ? a : b)) : null,
      },
      items: pageIds.flatMap((id) => {
        const row = byId.get(id);
        if (!row) return [];
        const { latest, ...p } = row;
        const v = values.get(id);
        return [
          {
            ...p,
            metrics: v?.metrics ? { ...v.metrics, videoViews: null } : null,
            partial: v?.partial ?? false,
            dataStatus: latest?.dataStatus ?? null,
            asOf: row.dailyTo,
          },
        ];
      }),
    };
  }

  /**
   * One post with everything collected for it: every lifetime metric the platform reports (latest
   * snapshot per metric) and, where the platform has them (ADR-0013), daily values for the covered
   * days — a covered day without a row is zero activity, outside the coverage there is no data.
   */
  @Get('content/:postId')
  async post(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('postId', ParseUUIDPipe) postId: string,
    @Req() request: { workspace: WorkspaceRequestContext },
  ) {
    await this.visibleProject(request.workspace, projectId);
    const db = this.prisma.client;
    const post = await db.socialPost.findFirst({
      where: {
        id: postId,
        projectId,
        workspaceId: request.workspace.workspaceId,
        account: { hiddenAt: null, connection: { status: { not: 'REVOKED' } } },
      },
      select: {
        ...POST_SELECT,
        dailyFrom: true,
        account: { select: { id: true, username: true, displayName: true, platform: true } },
      },
    });
    if (!post) throw new NotFoundException();
    const { latest, ...rest } = post;

    const snapshots = await db.postMetricValue.findMany({
      where: { postId, dimensionKey: '' },
      distinct: ['metricId'],
      orderBy: [{ metricId: 'asc' }, { date: 'desc' }],
      select: { value: true, dataStatus: true, date: true, metric: { select: { key: true } } },
    });

    type DailyPoint = { value: number | null; status: string };
    let daily: { from: string; to: string; series: Record<string, DailyPoint[]> } | null = null;
    if (post.dailyFrom && post.dailyTo) {
      const from = day(post.dailyFrom);
      const to = day(post.dailyTo);
      const rows = await db.postMetricDaily.findMany({
        where: { postId },
        select: { date: true, value: true, dataStatus: true, metric: { select: { key: true } } },
      });
      const days = Math.round((asDate(to).getTime() - asDate(from).getTime()) / DAY_MS) + 1;
      const series: Record<string, DailyPoint[]> = {};
      for (const r of rows) {
        const i = Math.round((r.date.getTime() - asDate(from).getTime()) / DAY_MS);
        if (i < 0 || i >= days) continue;
        // Covered days without a row had no activity: zero, settled.
        series[r.metric.key] ??= Array.from({ length: days }, () => ({
          value: 0,
          status: 'READY',
        }));
        series[r.metric.key]![i] = {
          value: r.value === null ? null : Math.round(r.value),
          status: r.dataStatus,
        };
      }
      daily = { from, to, series };
    }

    return {
      ...rest,
      dataStatus: latest?.dataStatus ?? null,
      asOf: latest?.asOfDate ?? null,
      metrics: snapshots.map((m) => ({
        key: m.metric.key,
        value: m.value === null ? null : Math.round(m.value * 100) / 100,
        dataStatus: m.dataStatus,
        date: day(m.date),
      })),
      daily,
    };
  }

  /** Boards of the project's accounts, for the content filter. */
  @Get('boards')
  async boards(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Req() request: { workspace: WorkspaceRequestContext },
  ) {
    await this.visibleProject(request.workspace, projectId);
    return this.prisma.client.socialBoard.findMany({
      where: {
        projectId,
        workspaceId: request.workspace.workspaceId,
        account: { hiddenAt: null, connection: { status: { not: 'REVOKED' } } },
      },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, accountId: true, pinCount: true },
    });
  }
}
