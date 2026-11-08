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
import { PrismaService } from '../prisma.service.js';
import { visibleProjectsWhere } from '../workspaces/project-visibility.js';
import {
  WorkspaceAccessGuard,
  type WorkspaceRequestContext,
} from '../workspaces/workspace-access.guard.js';
import {
  breakdown,
  dailyMetric,
  dailySeries,
  periods,
  snapshotMetric,
  type StoredValue,
} from './aggregate.js';
import { PLATFORM_FEATURES, hasFeature } from '@adelie/platforms';
import { countsAsSale, salesOverview } from '../sales/sales.js';

const PERIOD_DAYS = [7, 30, 90] as const;
type Platform = 'PINTEREST' | 'INSTAGRAM';
/** Points of sale get the sales overview (ADR-0018). */
const SALES_PLATFORMS = ['ETSY'] as const;
type SalesPlatform = (typeof SALES_PLATFORMS)[number];
const isSales = (p: string): p is SalesPlatform =>
  (SALES_PLATFORMS as readonly string[]).includes(p);

/**
 * What the overview shows per platform (one platform at a time: their metrics differ and must not
 * be added up — Pinterest impressions ≠ Instagram views, ADR-0015).
 * - kpis: [response id, metric key, DAILY sum or SNAPSHOT]
 * - series: the daily chart; breakdown: a dimension of one metric, or several metrics side by side.
 */
const OVERVIEW: Record<
  Platform,
  {
    kpis: { id: string; key: string; kind: 'daily' | 'snapshot' }[];
    series: { id: string; key: string };
    breakdown:
      | { id: string; type: 'dimension'; key: string; dimension: string }
      | { id: string; type: 'metrics'; items: { id: string; key: string }[] };
  }
> = {
  PINTEREST: {
    kpis: [
      { id: 'impressions', key: 'impressions', kind: 'daily' },
      { id: 'saves', key: 'saves', kind: 'daily' },
      { id: 'outboundClicks', key: 'outbound_clicks', kind: 'daily' },
      { id: 'followers', key: 'followers', kind: 'snapshot' },
    ],
    series: { id: 'impressions', key: 'impressions' },
    breakdown: { id: 'devices', type: 'dimension', key: 'impressions', dimension: 'app_type' },
  },
  INSTAGRAM: {
    kpis: [
      { id: 'views', key: 'views', kind: 'daily' },
      { id: 'engagements', key: 'engagements', kind: 'daily' },
      { id: 'newFollowers', key: 'new_followers', kind: 'daily' },
      { id: 'followers', key: 'followers', kind: 'snapshot' },
    ],
    series: { id: 'views', key: 'views' },
    breakdown: {
      id: 'interactions',
      type: 'metrics',
      items: [
        { id: 'likes', key: 'likes' },
        { id: 'saves', key: 'saves' },
        { id: 'comments', key: 'comments' },
        { id: 'shares', key: 'shares' },
      ],
    },
  },
};

/** Project overview of one platform: key metrics, a daily chart and a breakdown (ADR-0008). */
@Controller('workspaces/:workspaceId/projects/:projectId/overview')
@UseGuards(WorkspaceAccessGuard)
export class OverviewController {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Who the audience is (account level), where the platform has an audience feature: the latest
   * snapshot per type, or `missing` when the connection lacks the permission (update access).
   */
  private async audience(platform: Platform | undefined, accountIds: string[]) {
    if (!platform || !PLATFORM_FEATURES[platform].some((f) => f.id === 'audience')) return null;
    const connections = await this.prisma.client.socialAccount.findMany({
      where: { id: { in: accountIds } },
      select: { id: true, connection: { select: { scopes: true } } },
    });
    const allowed = connections
      .filter((c) => hasFeature(platform, c.connection.scopes, 'audience'))
      .map((c) => c.id);
    if (!allowed.length) return { missing: true, items: [] };
    const rows = await this.prisma.client.accountAudience.findMany({
      where: { accountId: { in: allowed } },
      orderBy: { date: 'desc' },
      distinct: ['type'],
      select: { type: true, date: true, size: true, sizeIsUpperBound: true, groups: true },
    });
    return {
      missing: false,
      items: rows.map((r) => ({ ...r, date: r.date.toISOString().slice(0, 10) })),
    };
  }

  @Get()
  async get(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Query('days') daysParam: string | undefined,
    @Query('accountId') accountId: string | undefined,
    @Query('platform') platformParam: string | undefined,
    @Req() request: { workspace: WorkspaceRequestContext },
  ) {
    const days = Number(daysParam ?? 30);
    if (!(PERIOD_DAYS as readonly number[]).includes(days)) {
      throw new BadRequestException('days must be 7, 30 or 90');
    }
    const project = await this.prisma.client.project.findFirst({
      where: { id: projectId, ...visibleProjectsWhere(request.workspace) },
      select: { id: true },
    });
    if (!project) throw new NotFoundException();

    const all = await this.prisma.client.socialAccount.findMany({
      where: {
        projectId,
        workspaceId: request.workspace.workspaceId,
        ...(accountId ? { id: accountId } : {}),
        // Disconnected and hidden accounts are left out: their history is kept.
        hiddenAt: null,
        connection: { status: { not: 'REVOKED' } },
      },
      select: {
        id: true,
        platform: true,
        username: true,
        displayName: true,
        historyAvailableFrom: true,
        collectingSince: true,
      },
      orderBy: { createdAt: 'asc' },
    });
    if (accountId && all.length === 0) throw new NotFoundException();
    const platforms = [...new Set(all.map((a) => a.platform))].filter(
      (p): p is Platform | SalesPlatform => p in OVERVIEW || isSales(p),
    );
    if (platformParam && !(platformParam in OVERVIEW) && !isSales(platformParam)) {
      throw new BadRequestException('Unknown platform');
    }
    const chosen = (
      platformParam && platforms.includes(platformParam as Platform) ? platformParam : platforms[0]
    ) as Platform | SalesPlatform | undefined;
    const today = new Date().toISOString().slice(0, 10);
    const { current, previous } = periods(days, today);

    if (chosen && isSales(chosen)) {
      const shops = all.filter((a) => a.platform === chosen);
      const orders = await this.prisma.client.shopOrder.findMany({
        where: {
          accountId: { in: shops.map((a) => a.id) },
          orderedAt: {
            gte: new Date(`${previous.from}T00:00:00Z`),
            lt: new Date(new Date(`${current.to}T00:00:00Z`).getTime() + 86_400_000),
          },
        },
        select: {
          orderedAt: true,
          status: true,
          currency: true,
          total: true,
          tax: true,
          country: true,
          items: { select: { quantity: true } },
        },
      });
      const sales = salesOverview(
        // Canceled and fully refunded orders are not sales.
        orders
          .filter((o) => countsAsSale(o.status))
          .map(({ items, status: _status, ...o }) => ({
            ...o,
            units: items.reduce((n, i) => n + i.quantity, 0),
          })),
        current,
        previous,
      );
      return {
        platform: chosen,
        platforms,
        period: current,
        previousPeriod: previous,
        accounts: shops.map((a) => ({
          id: a.id,
          platform: a.platform,
          username: a.username,
          displayName: a.displayName,
        })),
        // Orders carry their whole history: no platform limit to explain.
        historyFrom: null,
        currency: sales.currency,
        kpis: sales.kpis,
        series: { id: 'revenue', points: sales.series },
        breakdown: { id: 'countries', items: sales.breakdown },
      };
    }

    const platform = chosen;
    const accounts = all.filter((a) => a.platform === platform);
    const view = OVERVIEW[platform ?? 'PINTEREST'];
    const keys = [
      ...new Set([
        ...view.kpis.map((k) => k.key),
        view.series.key,
        ...(view.breakdown.type === 'dimension'
          ? [view.breakdown.key]
          : view.breakdown.items.map((i) => i.key)),
      ]),
    ];

    const rows = accounts.length
      ? await this.prisma.client.accountMetricValue.findMany({
          where: {
            accountId: { in: accounts.map((a) => a.id) },
            date: {
              gte: new Date(`${previous.from}T00:00:00Z`),
              lte: new Date(`${current.to}T00:00:00Z`),
            },
            metric: { platform, key: { in: keys } },
          },
          select: {
            accountId: true,
            date: true,
            dimensionKey: true,
            value: true,
            dataStatus: true,
            metric: { select: { key: true } },
          },
        })
      : [];
    // Followers snapshots may predate the comparison window: take the latest one before it too.
    const olderFollowers = accounts.length
      ? await this.prisma.client.accountMetricValue.findMany({
          where: {
            accountId: { in: accounts.map((a) => a.id) },
            date: { lt: new Date(`${previous.from}T00:00:00Z`) },
            dimensionKey: '',
            metric: { platform, key: 'followers' },
          },
          distinct: ['accountId'],
          orderBy: [{ accountId: 'asc' }, { date: 'desc' }],
          select: {
            accountId: true,
            date: true,
            dimensionKey: true,
            value: true,
            dataStatus: true,
          },
        })
      : [];

    const values: StoredValue[] = [
      ...rows.map((r) => ({
        accountId: r.accountId,
        key: r.metric.key,
        date: r.date.toISOString().slice(0, 10),
        dimensionKey: r.dimensionKey,
        value: r.value,
        dataStatus: r.dataStatus,
      })),
      ...olderFollowers.map((r) => ({
        accountId: r.accountId,
        key: 'followers',
        date: r.date.toISOString().slice(0, 10),
        dimensionKey: r.dimensionKey,
        value: r.value,
        dataStatus: r.dataStatus,
      })),
    ];

    const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
    const breakdownItems =
      view.breakdown.type === 'dimension'
        ? breakdown(values, view.breakdown.key, view.breakdown.dimension, current)
        : view.breakdown.items
            .map((i) => ({
              key: i.id,
              value: dailyMetric(values, i.key, current, previous).value ?? 0,
            }))
            .filter((i) => i.value > 0)
            .sort((a, b) => b.value - a.value);
    return {
      platform: platform ?? null,
      platforms,
      period: current,
      previousPeriod: previous,
      accounts: accounts.map((a) => ({
        id: a.id,
        platform: a.platform,
        username: a.username,
        displayName: a.displayName,
      })),
      /** Earliest date with platform history among the selected accounts. */
      historyFrom:
        accounts
          .map((a) => day(a.historyAvailableFrom))
          .filter((d): d is string => !!d)
          .sort()[0] ?? null,
      kpis: view.kpis.map((k) => ({
        id: k.id,
        ...(k.kind === 'daily'
          ? dailyMetric(values, k.key, current, previous)
          : snapshotMetric(values, k.key, current, previous)),
      })),
      series: { id: view.series.id, points: dailySeries(values, view.series.key, current) },
      breakdown: { id: view.breakdown.id, items: breakdownItems },
      audience: await this.audience(
        platform,
        accounts.map((a) => a.id),
      ),
    };
  }
}
