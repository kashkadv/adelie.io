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
import { linkKey, productKeys } from '@adelie/platforms';
import { periodOf } from '../flipper/period.js';
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
  carriedLinks,
  channelOf,
  newLinkCode,
  parseDestination,
  parseLinkInput,
} from './links.js';
import { linkResults } from './link-stats.js';
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

const isUuid = (v: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

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
    @Query('product') productId: string | undefined,
    @Query('post') postId: string | undefined,
    @Req() request: { workspace: WorkspaceRequestContext },
  ) {
    const ctx = request.workspace;
    const project = await this.visibleProject(ctx, projectId);
    const { n, since } = periodOf(days, project.timezone);
    const db = this.prisma.client;
    // For a product's or a post's card: every link of it, archived ones included.
    const of = productId
      ? await this.productFilter(projectId, ctx.workspaceId, productId)
      : postId
        ? await this.postFilter(projectId, ctx.workspaceId, postId)
        : null;
    let links = await db.trackedLink.findMany({
      where: {
        projectId,
        workspaceId: ctx.workspaceId,
        ...(of ? {} : { archivedAt: archived === '1' ? { not: null } : null }),
      },
      orderBy: { createdAt: 'desc' },
      select: LINK_SELECT,
    });
    if (of) links = links.filter(of);

    // A short form that did not reach Cloudflare is tried again (a few at a time).
    const unpublished = links.filter((l) => !l.publishedAt && !l.archivedAt).slice(0, 5);
    if (unpublished.length && shortUrlOf('x')) {
      const done = new Map(
        (await Promise.all(unpublished.map((l) => this.publish(l)))).map((l) => [l.id, l]),
      );
      links = links.map((l) => done.get(l.id) ?? l);
    }

    const results = await linkResults(this.prisma.client, projectId, ctx.workspaceId, links, since);

    return {
      days: n,
      shortLinks: !!shortUrlOf('x'),
      links: links.map((l) => ({
        ...present(l),
        ...results.get(l.id)!,
      })),
    };
  }

  /** Links that lead to the product: their destination is the product's page or listing. */
  private async productFilter(projectId: string, workspaceId: string, productId: string) {
    if (!isUuid(productId)) throw new BadRequestException();
    const product = await this.prisma.client.shopProduct.findFirst({
      where: { id: productId, projectId, workspaceId },
      select: { externalId: true, url: true, account: { select: { platform: true } } },
    });
    if (!product) throw new NotFoundException();
    const keys = new Set(
      productKeys({
        platform: product.account.platform,
        externalId: product.externalId,
        url: product.url,
      }),
    );
    return (l: LinkRow) => keys.has(linkKey(l.destination) ?? '');
  }

  /**
   * Links a post carries: a short link by its code, a full one by its labels (`utm_source` and
   * `utm_content` of an address in the post).
   */
  private async postFilter(projectId: string, workspaceId: string, postId: string) {
    if (!isUuid(postId)) throw new BadRequestException();
    const post = await this.prisma.client.socialPost.findFirst({
      where: { id: postId, projectId, workspaceId },
      select: { links: { select: { url: true } } },
    });
    if (!post) throw new NotFoundException();
    const carried = carriedLinks(post.links.map((l) => l.url));
    return (l: LinkRow) => carried.has(l);
  }

  /**
   * The project's catalogue products with a page — for choosing where a new link leads. Etsy
   * listings and site products, without removed ones.
   */
  @Get('products')
  async products(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Req() request: { workspace: WorkspaceRequestContext },
  ) {
    await this.visibleProject(request.workspace, projectId);
    const rows = await this.prisma.client.shopProduct.findMany({
      where: {
        projectId,
        workspaceId: request.workspace.workspaceId,
        url: { not: null },
        state: { not: 'removed' },
        account: {
          platform: { in: ['ETSY', 'WEBSITE'] },
          hiddenAt: null,
          connection: { status: { not: 'REVOKED' } },
        },
      },
      orderBy: { title: 'asc' },
      take: 2000,
      select: {
        id: true,
        title: true,
        url: true,
        account: { select: { platform: true, displayName: true, username: true } },
      },
    });
    return {
      products: rows.map((p) => ({
        id: p.id,
        title: p.title,
        url: p.url!,
        channel: p.account.displayName ?? p.account.username ?? p.account.platform,
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
