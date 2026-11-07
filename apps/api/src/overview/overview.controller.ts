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

const PERIOD_DAYS = [7, 30, 90] as const;
const DAILY_KEYS = ['impressions', 'saves', 'outbound_clicks'] as const;

/** Project overview: key metrics, daily impressions and device breakdown (ADR-0008 aggregation). */
@Controller('workspaces/:workspaceId/projects/:projectId/overview')
@UseGuards(WorkspaceAccessGuard)
export class OverviewController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async get(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Query('days') daysParam: string | undefined,
    @Query('accountId') accountId: string | undefined,
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

    const accounts = await this.prisma.client.socialAccount.findMany({
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
    if (accountId && accounts.length === 0) throw new NotFoundException();

    const today = new Date().toISOString().slice(0, 10);
    const { current, previous } = periods(days, today);

    const rows = accounts.length
      ? await this.prisma.client.accountMetricValue.findMany({
          where: {
            accountId: { in: accounts.map((a) => a.id) },
            date: {
              gte: new Date(`${previous.from}T00:00:00Z`),
              lte: new Date(`${current.to}T00:00:00Z`),
            },
            metric: { key: { in: [...DAILY_KEYS, 'followers'] } },
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
            metric: { key: 'followers' },
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
    return {
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
      metrics: {
        impressions: dailyMetric(values, 'impressions', current, previous),
        saves: dailyMetric(values, 'saves', current, previous),
        outboundClicks: dailyMetric(values, 'outbound_clicks', current, previous),
        followers: snapshotMetric(values, 'followers', current, previous),
      },
      series: dailySeries(values, 'impressions', current),
      devices: breakdown(values, 'impressions', 'app_type', current),
    };
  }
}
