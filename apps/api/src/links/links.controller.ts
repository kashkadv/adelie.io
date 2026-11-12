import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { UseGuards } from '@nestjs/common';
import { Prisma } from '@adelie/db';
import { periodOf } from '../flipper/period.js';
import { goalSql, settingsOf } from '../flipper/site-kinds.js';
import { CONNECT_ROLES } from '../social/connect.service.js';
import { PrismaService } from '../prisma.service.js';
import { visibleProjectsWhere } from '../workspaces/project-visibility.js';
import {
  WorkspaceAccessGuard,
  WorkspaceRoles,
  type WorkspaceRequestContext,
} from '../workspaces/workspace-access.guard.js';
import {
  buildLinkUrl,
  channelOf,
  hostOfUrl,
  newLinkCode,
  parseDestination,
  parseLinkInput,
} from './links.js';
import { publishShortLink, shortUrlOf } from './short-links.js';

const LINK_SELECT = {
  id: true,
  code: true,
  name: true,
  destination: true,
  source: true,
  medium: true,
  campaign: true,
  content: true,
  publishedAt: true,
  createdAt: true,
  archivedAt: true,
} as const;
type LinkRow = Prisma.TrackedLinkGetPayload<{ select: typeof LINK_SELECT }>;

/** A link as the cabinet shows it: both forms, its channel. */
function present(link: LinkRow) {
  return {
    ...link,
    channel: channelOf(link.source, link.medium),
    url: buildLinkUrl(link.destination, link),
    shortUrl: link.publishedAt ? shortUrlOf(link.code) : null,
  };
}

const key = (l: { source: string; medium: string; campaign: string | null; content: string }) =>
  [l.source, l.medium, l.campaign ?? '', l.content].join('\u0000');

/**
 * Link Builder (ADR-0027): a project's tracked links — the full address with campaign labels and a
 * short go.adelie.space form — and what each brought: clicks, and on the project's Flipper sites
 * visits and goals of the events carrying its labels.
 */
@Controller('workspaces/:workspaceId/projects/:projectId/links')
@UseGuards(WorkspaceAccessGuard)
export class LinksController {
  constructor(private readonly prisma: PrismaService) {}

  private async visibleProject(ctx: WorkspaceRequestContext, projectId: string) {
    const project = await this.prisma.client.project.findFirst({
      where: { id: projectId, ...visibleProjectsWhere(ctx) },
      select: { id: true, timezone: true },
    });
    if (!project) throw new NotFoundException();
    return project;
  }

  private async linkOf(ctx: WorkspaceRequestContext, projectId: string, id: string) {
    await this.visibleProject(ctx, projectId);
    const link = await this.prisma.client.trackedLink.findFirst({
      where: { id, projectId, workspaceId: ctx.workspaceId },
      select: LINK_SELECT,
    });
    if (!link) throw new NotFoundException();
    return link;
  }

  /** Writes the short form to KV; remembers when it got there. */
  private async publish(link: LinkRow): Promise<LinkRow> {
    if (!(await publishShortLink(link.code, buildLinkUrl(link.destination, link)))) return link;
    return this.prisma.client.trackedLink.update({
      where: { id: link.id },
      data: { publishedAt: new Date() },
      select: LINK_SELECT,
    });
  }

  /** The project's links with what they brought in the period; archived ones on request. */
  @Get()
  async list(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Query('days') days: string | undefined,
    @Query('archived') archived: string | undefined,
    @Req() request: { workspace: WorkspaceRequestContext },
  ) {
    const ctx = request.workspace;
    const project = await this.visibleProject(ctx, projectId);
    const { n, since } = periodOf(days, project.timezone);
    const db = this.prisma.client;
    let links = await db.trackedLink.findMany({
      where: {
        projectId,
        workspaceId: ctx.workspaceId,
        archivedAt: archived === '1' ? { not: null } : null,
      },
      orderBy: { createdAt: 'desc' },
      select: LINK_SELECT,
    });

    // A short form that did not reach Cloudflare is tried again (a few at a time).
    const unpublished = links.filter((l) => !l.publishedAt && !l.archivedAt).slice(0, 5);
    if (unpublished.length && shortUrlOf('x')) {
      const done = new Map(
        (await Promise.all(unpublished.map((l) => this.publish(l)))).map((l) => [l.id, l]),
      );
      links = links.map((l) => done.get(l.id) ?? l);
    }

    const ids = links.map((l) => l.id);
    const clicks = ids.length
      ? await db.$queryRaw<{ linkId: string; clicks: number }[]>`
          SELECT "linkId", count(*)::int AS clicks FROM link_click
          WHERE "linkId" = ANY(${ids}::uuid[]) AND "occurredAt" >= ${since} AND NOT "isBot"
          GROUP BY 1`
      : [];
    const clicksOf = new Map(clicks.map((c) => [c.linkId, c.clicks]));

    // Visits and goals: on the project's sites with Flipper, by the links' labels.
    const sites = links.length
      ? await db.trackedSite.findMany({
          where: { projectId, workspaceId: ctx.workspaceId },
          select: { id: true, allowedHosts: true, kind: true, goals: true, funnel: true },
        })
      : [];
    const results = new Map<
      string,
      {
        visits: number;
        visitors: number;
        conversions: number;
        value: number | null;
        currency: string | null;
      }
    >();
    for (const site of sites) {
      const hosts = site.allowedHosts.map((h) => h.replace(/^www\./, '').toLowerCase());
      const mine = links.filter((l) => hosts.includes(hostOfUrl(l.destination) ?? ''));
      if (!mine.length) continue;
      const { goals } = settingsOf(site);
      const anyGoal = goals.length
        ? Prisma.join(
            goals.map((g) => goalSql(g.rule)),
            ' OR ',
          )
        : Prisma.sql`false`;
      const valued = goals.filter((g) => g.valued);
      const anyValued = valued.length
        ? Prisma.join(
            valued.map((g) => goalSql(g.rule)),
            ' OR ',
          )
        : Prisma.sql`false`;
      const rows = await db.$queryRaw<
        {
          source: string;
          medium: string;
          campaign: string;
          content: string;
          visits: number;
          visitors: number;
          conversions: number;
          value: number | null;
        }[]
      >`
        SELECT "source", "medium", coalesce("campaign", '') AS campaign, "content",
          (count(DISTINCT "sessionId") FILTER (WHERE consent AND name = 'PageView')
            + count(*) FILTER (WHERE NOT consent AND name = 'PageView'))::int AS visits,
          count(DISTINCT coalesce("visitorId", "dailyId")) FILTER (WHERE name = 'PageView')::int AS visitors,
          count(*) FILTER (WHERE ${anyGoal})::int AS conversions,
          sum(CASE WHEN (${anyValued}) AND jsonb_typeof(properties->'value') = 'number'
            THEN (properties->>'value')::numeric END)::float8 AS value
        FROM website_event
        WHERE "siteId" = ${site.id}::uuid AND "occurredAt" >= ${since} AND NOT "isBot"
          AND "content" = ANY(${[...new Set(mine.map((l) => l.content))]}::text[])
        GROUP BY 1, 2, 3, 4`;
      // The site's currency: the latest one an event with a value reported (as Flipper shows it).
      const currency = valued.length
        ? ((
            await db.$queryRaw<{ currency: string | null }[]>`
              SELECT properties->>'currency' AS currency FROM website_event
              WHERE "siteId" = ${site.id}::uuid AND properties->>'currency' IS NOT NULL
              ORDER BY "occurredAt" DESC LIMIT 1`
          )[0]?.currency ?? null)
        : null;
      for (const r of rows) {
        results.set(key({ ...r, campaign: r.campaign || null }), {
          visits: r.visits,
          visitors: r.visitors,
          conversions: r.conversions,
          value: valued.length ? (r.value ?? 0) : null,
          currency,
        });
      }
    }
    const tracked = new Set(
      sites.flatMap((s) => s.allowedHosts.map((h) => h.replace(/^www\./, '').toLowerCase())),
    );

    return {
      days: n,
      shortLinks: !!shortUrlOf('x'),
      links: links.map((l) => ({
        ...present(l),
        clicks: clicksOf.get(l.id) ?? 0,
        // null: the destination is not a site with Flipper, so visits are not known here.
        site: tracked.has(hostOfUrl(l.destination) ?? '')
          ? (results.get(key(l)) ?? {
              visits: 0,
              visitors: 0,
              conversions: 0,
              value: null,
              currency: null,
            })
          : null,
      })),
    };
  }

  /** Campaign names already used in the project, the latest first: suggestions for a new link. */
  @Get('campaigns')
  async campaigns(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Req() request: { workspace: WorkspaceRequestContext },
  ) {
    await this.visibleProject(request.workspace, projectId);
    const rows = await this.prisma.client.$queryRaw<{ campaign: string }[]>`
      SELECT "campaign" FROM tracked_link
      WHERE "projectId" = ${projectId}::uuid AND "workspaceId" = ${request.workspace.workspaceId}::uuid
        AND "campaign" IS NOT NULL
      GROUP BY 1 ORDER BY max("createdAt") DESC LIMIT 50`;
    return { campaigns: rows.map((r) => r.campaign) };
  }

  /** A new link. Its labels must differ from every active link of the project. */
  @Post()
  @WorkspaceRoles(...CONNECT_ROLES)
  async create(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() body: Record<string, unknown> | undefined,
    @Req() request: { workspace: WorkspaceRequestContext },
  ) {
    const ctx = request.workspace;
    await this.visibleProject(ctx, projectId);
    const db = this.prisma.client;
    let code = newLinkCode();
    while (await db.trackedLink.findUnique({ where: { code }, select: { id: true } })) {
      code = newLinkCode();
    }
    const parsed = parseLinkInput(body ?? {}, code);
    if (!parsed.ok) throw new BadRequestException({ errors: { [parsed.error]: 'invalid' } });
    const { labels } = parsed;
    const same = await db.trackedLink.findFirst({
      where: {
        projectId,
        workspaceId: ctx.workspaceId,
        archivedAt: null,
        source: labels.source,
        medium: labels.medium,
        campaign: labels.campaign,
        content: labels.content,
      },
      select: { id: true },
    });
    if (same) throw new ConflictException({ errors: { content: 'taken' }, linkId: same.id });
    const link = await db.trackedLink.create({
      data: {
        workspaceId: ctx.workspaceId,
        projectId,
        code,
        name: parsed.name,
        destination: parsed.destination,
        ...labels,
      },
      select: LINK_SELECT,
    });
    return present(await this.publish(link));
  }

  /**
   * Changes a link's name or destination (the labels are in published addresses and stay), or
   * archives / restores it. A new destination reaches the short form at once.
   */
  @Patch(':id')
  @WorkspaceRoles(...CONNECT_ROLES)
  async update(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { name?: unknown; destination?: unknown; archived?: unknown } | undefined,
    @Req() request: { workspace: WorkspaceRequestContext },
  ) {
    const link = await this.linkOf(request.workspace, projectId, id);
    const data: Prisma.TrackedLinkUpdateInput = {};
    if (body?.name !== undefined) {
      const name = typeof body.name === 'string' ? body.name.trim().slice(0, 120) : '';
      data.name = name || null;
    }
    let moved = false;
    if (body?.destination !== undefined) {
      const url = parseDestination(body.destination);
      if (!url) throw new BadRequestException({ errors: { destination: 'invalid' } });
      moved = url.toString() !== link.destination;
      data.destination = url.toString();
    }
    if (body?.archived !== undefined) {
      if (typeof body.archived !== 'boolean') {
        throw new BadRequestException({ errors: { archived: 'invalid' } });
      }
      if (!body.archived && link.archivedAt) {
        const same = await this.prisma.client.trackedLink.findFirst({
          where: {
            projectId,
            archivedAt: null,
            source: link.source,
            medium: link.medium,
            campaign: link.campaign,
            content: link.content,
            NOT: { id: link.id },
          },
          select: { id: true },
        });
        if (same) throw new ConflictException({ errors: { content: 'taken' }, linkId: same.id });
      }
      data.archivedAt = body.archived ? (link.archivedAt ?? new Date()) : null;
    }
    // A moved link is not where the short form says until KV has it again.
    if (moved) data.publishedAt = null;
    const saved = await this.prisma.client.trackedLink.update({
      where: { id: link.id },
      data,
      select: LINK_SELECT,
    });
    return present(moved ? await this.publish(saved) : saved);
  }
}
