import { randomBytes } from 'node:crypto';
import {
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Prisma } from '@adelie/db';
import { CONNECT_ROLES } from '../social/connect.service.js';
import { PrismaService } from '../prisma.service.js';
import { visibleProjectsWhere } from '../workspaces/project-visibility.js';
import {
  WorkspaceAccessGuard,
  WorkspaceRoles,
  type WorkspaceRequestContext,
} from '../workspaces/workspace-access.guard.js';

const BASE62 = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const newPublicId = () =>
  `fl_${Array.from(randomBytes(12), (b) => BASE62[b % BASE62.length]).join('')}`;

const hostOf = (url: string): string | null => {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return null;
  }
};

/** The funnel of a shop, in the order a customer goes through it. */
export const FUNNEL = ['ViewCategory', 'ProductView', 'AddToCart', 'BeginCheckout'] as const;

/**
 * Flipper in the cabinet (ADR-0022): which of the project's sites send events, how to install it,
 * what has arrived. Every site is a connected website; its tracker is switched on here.
 */
@Controller('workspaces/:workspaceId/projects/:projectId/flipper')
@UseGuards(WorkspaceAccessGuard)
export class FlipperController {
  constructor(private readonly prisma: PrismaService) {}

  private async visibleProject(ctx: WorkspaceRequestContext, projectId: string) {
    const project = await this.prisma.client.project.findFirst({
      where: { id: projectId, ...visibleProjectsWhere(ctx) },
      select: { id: true },
    });
    if (!project) throw new NotFoundException();
  }

  private async siteOf(ctx: WorkspaceRequestContext, projectId: string, accountId: string) {
    await this.visibleProject(ctx, projectId);
    const site = await this.prisma.client.trackedSite.findFirst({
      where: { accountId, projectId, workspaceId: ctx.workspaceId },
      select: { id: true, publicId: true },
    });
    if (!site) throw new NotFoundException();
    return site;
  }

  /** The project's sites, and for those with a tracker: its id, and what arrived in a week. */
  @Get()
  async list(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Req() request: { workspace: WorkspaceRequestContext },
  ) {
    await this.visibleProject(request.workspace, projectId);
    const db = this.prisma.client;
    const accounts = await db.socialAccount.findMany({
      where: {
        projectId,
        workspaceId: request.workspace.workspaceId,
        platform: 'WEBSITE',
        hiddenAt: null,
        connection: { status: { not: 'REVOKED' } },
      },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        username: true,
        displayName: true,
        externalId: true,
        trackedSite: { select: { id: true, publicId: true, allowedHosts: true, createdAt: true } },
      },
    });
    const since = new Date(Date.now() - 7 * 86_400_000);
    return Promise.all(
      accounts.map(async ({ trackedSite, externalId, ...account }) => {
        if (!trackedSite) return { ...account, host: hostOf(externalId), site: null };
        const [last, events7d] = await Promise.all([
          db.websiteEvent.findFirst({
            where: { siteId: trackedSite.id },
            orderBy: { receivedAt: 'desc' },
            select: { receivedAt: true },
          }),
          db.websiteEvent.count({
            where: { siteId: trackedSite.id, occurredAt: { gte: since }, isBot: false },
          }),
        ]);
        return {
          ...account,
          host: hostOf(externalId),
          site: {
            publicId: trackedSite.publicId,
            allowedHosts: trackedSite.allowedHosts,
            createdAt: trackedSite.createdAt,
            lastEventAt: last?.receivedAt ?? null,
            events7d,
          },
        };
      }),
    );
  }

  /** Switches the tracker on for a site: it gets its id, and its own host as the allowed one. */
  @Post(':accountId')
  @WorkspaceRoles(...CONNECT_ROLES)
  async enable(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('accountId', ParseUUIDPipe) accountId: string,
    @Req() request: { workspace: WorkspaceRequestContext },
  ) {
    await this.visibleProject(request.workspace, projectId);
    const db = this.prisma.client;
    const account = await db.socialAccount.findFirst({
      where: {
        id: accountId,
        projectId,
        workspaceId: request.workspace.workspaceId,
        platform: 'WEBSITE',
      },
      select: { id: true, externalId: true, trackedSite: { select: { publicId: true } } },
    });
    if (!account) throw new NotFoundException();
    if (account.trackedSite) return { publicId: account.trackedSite.publicId };
    const host = hostOf(account.externalId);
    const site = await db.trackedSite.create({
      data: {
        workspaceId: request.workspace.workspaceId,
        projectId,
        accountId: account.id,
        publicId: newPublicId(),
        allowedHosts: host ? [host] : [],
      },
      select: { publicId: true },
    });
    return site;
  }

  /** The latest events, newest first. Bots are left out. */
  @Get(':accountId/events')
  async events(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('accountId', ParseUUIDPipe) accountId: string,
    @Query('limit') limit: string | undefined,
    @Req() request: { workspace: WorkspaceRequestContext },
  ) {
    const site = await this.siteOf(request.workspace, projectId, accountId);
    const rows = await this.prisma.client.websiteEvent.findMany({
      where: { siteId: site.id, isBot: false },
      orderBy: { occurredAt: 'desc' },
      take: Math.min(Math.max(Number(limit) || 50, 1), 200),
      select: {
        id: true,
        name: true,
        occurredAt: true,
        consent: true,
        visitorId: true,
        dailyId: true,
        url: true,
        channel: true,
        source: true,
        medium: true,
        campaign: true,
        device: true,
        properties: true,
      },
    });
    // The visitor as a short label (never the id itself): enough to tell people apart in a list.
    return rows.map(({ visitorId, dailyId, ...e }) => ({
      ...e,
      visitor: (visitorId ?? dailyId)?.slice(0, 6) ?? null,
    }));
  }

  /**
   * A period at a glance: what happened and how many people did it. `visitors` per day counts a
   * person once a day with or without consent; the funnel and the products only those who agreed
   * (a person is known across pages only then).
   */
  @Get(':accountId/summary')
  async summary(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('accountId', ParseUUIDPipe) accountId: string,
    @Query('days') days: string | undefined,
    @Req() request: { workspace: WorkspaceRequestContext },
  ) {
    const site = await this.siteOf(request.workspace, projectId, accountId);
    const n = [7, 30, 90].includes(Number(days)) ? Number(days) : 7;
    const since = new Date(Date.now() - n * 86_400_000);
    const db = this.prisma.client;
    const sid = site.id;
    const [counts, daily, funnel, channels, products, consent] = await Promise.all([
      db.$queryRaw<{ name: string; events: number }[]>`
        SELECT name, count(*)::int AS events FROM website_event
        WHERE "siteId" = ${sid}::uuid AND "occurredAt" >= ${since} AND NOT "isBot"
        GROUP BY name ORDER BY events DESC`,
      db.$queryRaw<{ day: string; visitors: number; views: number }[]>`
        SELECT to_char(date_trunc('day', "occurredAt"), 'YYYY-MM-DD') AS day,
               count(DISTINCT coalesce("visitorId", "dailyId"))::int AS visitors,
               count(*)::int AS views
        FROM website_event
        WHERE "siteId" = ${sid}::uuid AND "occurredAt" >= ${since} AND NOT "isBot" AND name = 'PageView'
        GROUP BY 1 ORDER BY 1`,
      db.$queryRaw<{ name: string; visitors: number }[]>`
        SELECT name, count(DISTINCT "visitorId")::int AS visitors FROM website_event
        WHERE "siteId" = ${sid}::uuid AND "occurredAt" >= ${since} AND NOT "isBot"
          AND "visitorId" IS NOT NULL AND name IN (${Prisma.join([...FUNNEL])})
        GROUP BY name`,
      db.$queryRaw<{ channel: string; views: number }[]>`
        SELECT channel, count(*)::int AS views FROM website_event
        WHERE "siteId" = ${sid}::uuid AND "occurredAt" >= ${since} AND NOT "isBot"
          AND name = 'PageView' AND channel IS NOT NULL
        GROUP BY channel ORDER BY views DESC LIMIT 10`,
      db.$queryRaw<{ item: string; views: number; visitors: number }[]>`
        SELECT properties->>'item_id' AS item, count(*)::int AS views,
               count(DISTINCT coalesce("visitorId", "dailyId"))::int AS visitors
        FROM website_event
        WHERE "siteId" = ${sid}::uuid AND "occurredAt" >= ${since} AND NOT "isBot"
          AND name = 'ProductView' AND properties->>'item_id' IS NOT NULL
        GROUP BY 1 ORDER BY views DESC LIMIT 10`,
      db.$queryRaw<{ consenting: number; anonymous: number }[]>`
        SELECT count(*) FILTER (WHERE consent)::int AS consenting,
               count(*) FILTER (WHERE NOT consent)::int AS anonymous
        FROM website_event
        WHERE "siteId" = ${sid}::uuid AND "occurredAt" >= ${since} AND NOT "isBot"`,
    ]);
    const byName = new Map(funnel.map((f) => [f.name, f.visitors]));
    return {
      days: n,
      counts,
      daily,
      funnel: FUNNEL.map((name) => ({ name, visitors: byName.get(name) ?? 0 })),
      channels,
      products,
      consent: consent[0] ?? { consenting: 0, anonymous: 0 },
    };
  }
}
