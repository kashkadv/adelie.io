import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Prisma } from '@adelie/db';
import { CONNECT_ROLES, ConnectService } from '../social/connect.service.js';
import { PrismaService } from '../prisma.service.js';
import { countsAsSale } from '../sales/sales.js';
import { visibleProjectsWhere } from '../workspaces/project-visibility.js';
import {
  WorkspaceAccessGuard,
  WorkspaceRoles,
  type WorkspaceRequestContext,
} from '../workspaces/workspace-access.guard.js';
import {
  keywordPool,
  marketsFromOrders,
  parseMarkets,
  pinterestRegions,
  rankProducts,
  suggestProducts,
  type EtsyMarket,
  type TrendKeyword,
} from './research.js';
import { fetchEtsyMarket, fetchTrends } from './sources.js';

const CHANNELS = ['pinterest'] as const;
const SALES_PLATFORMS = ['ETSY', 'WEBSITE'] as const;
const DAY = 86_400_000;

const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const isDay = (v: unknown): v is string =>
  typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));
const parseKeywords = (v: unknown) =>
  Array.isArray(v)
    ? [...new Set(v.map((k) => text(k, 60).toLowerCase()).filter(Boolean))].slice(0, 5)
    : null;

/**
 * Niche research (ADR-0032): researches of a project — a niche, where its products are sold and
 * the channel that promotes them — their sources (Pinterest Trends, the Etsy market, own data), the
 * keyword pool and the ranking of the studied products; and the project's markets.
 */
@Controller('workspaces/:workspaceId/projects/:projectId/research')
@UseGuards(WorkspaceAccessGuard)
export class ResearchController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly connector: ConnectService,
  ) {}

  private async visibleProject(ctx: WorkspaceRequestContext, projectId: string) {
    const project = await this.prisma.client.project.findFirst({
      where: { id: projectId, ...visibleProjectsWhere(ctx) },
      select: { id: true, markets: true, deliveryDays: true },
    });
    if (!project) throw new NotFoundException();
    return project;
  }

  private async researchOf(ctx: WorkspaceRequestContext, projectId: string, id: string) {
    await this.visibleProject(ctx, projectId);
    const research = await this.prisma.client.research.findFirst({
      where: { id, projectId, workspaceId: ctx.workspaceId },
    });
    if (!research) throw new NotFoundException();
    return research;
  }

  /** The project's sales points: its Etsy shops and sites. */
  private salesAccounts(projectId: string, workspaceId: string) {
    return this.prisma.client.socialAccount.findMany({
      where: {
        projectId,
        workspaceId,
        platform: { in: [...SALES_PLATFORMS] },
        hiddenAt: null,
        connection: { status: { not: 'REVOKED' } },
      },
      select: { id: true, platform: true, displayName: true, username: true },
    });
  }

  /** The stored markets, or the ones the shop's orders suggest. */
  private async marketsOf(project: { id: string; markets: unknown }) {
    const stored = parseMarkets(project.markets);
    if (stored) return { markets: stored, suggested: false };
    const orders = await this.prisma.client.shopOrder.findMany({
      where: { projectId: project.id, orderedAt: { gte: new Date(Date.now() - 730 * DAY) } },
      select: { country: true, status: true },
    });
    return {
      markets: marketsFromOrders(
        orders.filter((o) => countsAsSale(o.status)).map((o) => o.country),
      ),
      suggested: true,
    };
  }

  /** The project's markets (stored or suggested from orders) and delivery days. */
  @Get('markets')
  async markets(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Req() request: { workspace: WorkspaceRequestContext },
  ) {
    const project = await this.visibleProject(request.workspace, projectId);
    return { ...(await this.marketsOf(project)), deliveryDays: project.deliveryDays };
  }

  @Put('markets')
  @WorkspaceRoles(...CONNECT_ROLES)
  async saveMarkets(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() body: { markets?: unknown; deliveryDays?: unknown } | undefined,
    @Req() request: { workspace: WorkspaceRequestContext },
  ) {
    await this.visibleProject(request.workspace, projectId);
    const markets = parseMarkets(body?.markets);
    const days = body?.deliveryDays;
    if (!markets) throw new BadRequestException({ errors: { markets: 'invalid' } });
    if (
      days !== null &&
      (typeof days !== 'number' || !Number.isInteger(days) || days < 1 || days > 90)
    ) {
      throw new BadRequestException({ errors: { deliveryDays: 'invalid' } });
    }
    await this.prisma.client.project.update({
      where: { id: projectId },
      data: { markets: markets as unknown as Prisma.InputJsonValue, deliveryDays: days },
    });
    return { markets, suggested: false, deliveryDays: days };
  }

  /** The project's researches, and what a new one can be made of. */
  @Get()
  async list(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Req() request: { workspace: WorkspaceRequestContext },
  ) {
    const ctx = request.workspace;
    await this.visibleProject(ctx, projectId);
    const [researches, sales] = await Promise.all([
      this.prisma.client.research.findMany({
        where: { projectId, workspaceId: ctx.workspaceId, archivedAt: null },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          name: true,
          keywords: true,
          salesAccountId: true,
          channel: true,
          productIds: true,
          endsOn: true,
          refreshedAt: true,
        },
      }),
      this.salesAccounts(projectId, ctx.workspaceId),
    ]);
    return {
      researches: researches.map(({ productIds, endsOn, ...r }) => ({
        ...r,
        products: productIds.length,
        endsOn: endsOn ? endsOn.toISOString().slice(0, 10) : null,
      })),
      salesAccounts: sales.map((a) => ({
        id: a.id,
        platform: a.platform,
        name: a.displayName ?? a.username ?? a.platform,
      })),
      channels: CHANNELS,
    };
  }

  /** A new research; its products are suggested from the sales point's catalogue by the niche. */
  @Post()
  @WorkspaceRoles(...CONNECT_ROLES)
  async create(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() body: Record<string, unknown> | undefined,
    @Req() request: { workspace: WorkspaceRequestContext },
  ) {
    const ctx = request.workspace;
    await this.visibleProject(ctx, projectId);
    const name = text(body?.['name'], 100);
    const keywords = parseKeywords(body?.['keywords']);
    const channel = body?.['channel'];
    if (!name) throw new BadRequestException({ errors: { name: 'invalid' } });
    if (!keywords?.length) throw new BadRequestException({ errors: { keywords: 'invalid' } });
    if (!CHANNELS.includes(channel as (typeof CHANNELS)[number])) {
      throw new BadRequestException({ errors: { channel: 'invalid' } });
    }
    const sales = await this.salesAccounts(projectId, ctx.workspaceId);
    const account = sales.find((a) => a.id === body?.['salesAccountId']);
    if (!account) throw new BadRequestException({ errors: { salesAccountId: 'invalid' } });
    const endsOn = body?.['endsOn'];
    if (endsOn !== undefined && endsOn !== null && !isDay(endsOn)) {
      throw new BadRequestException({ errors: { endsOn: 'invalid' } });
    }
    const catalogue = await this.prisma.client.shopProduct.findMany({
      where: { accountId: account.id, state: 'active' },
      orderBy: { favorers: { sort: 'desc', nulls: 'last' } },
      select: { id: true, title: true, tags: true, category: true },
    });
    const research = await this.prisma.client.research.create({
      data: {
        workspaceId: ctx.workspaceId,
        projectId,
        name,
        keywords,
        salesAccountId: account.id,
        channel: channel as string,
        productIds: suggestProducts(catalogue, keywords, 20).map((p) => p.id),
        endsOn: isDay(endsOn) ? new Date(`${endsOn}T00:00:00Z`) : null,
        directionId: text(body?.['directionId'], 40) || null,
      },
      select: { id: true },
    });
    return research;
  }

  /** Changes a research: its name, niche, products, season end, direction; archives it. */
  @Patch(':id')
  @WorkspaceRoles(...CONNECT_ROLES)
  async update(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: Record<string, unknown> | undefined,
    @Req() request: { workspace: WorkspaceRequestContext },
  ) {
    const ctx = request.workspace;
    const research = await this.researchOf(ctx, projectId, id);
    const data: Prisma.ResearchUpdateInput = {};
    if (body?.['name'] !== undefined) {
      const name = text(body['name'], 100);
      if (!name) throw new BadRequestException({ errors: { name: 'invalid' } });
      data.name = name;
    }
    if (body?.['keywords'] !== undefined) {
      const keywords = parseKeywords(body['keywords']);
      if (!keywords?.length) throw new BadRequestException({ errors: { keywords: 'invalid' } });
      data.keywords = keywords;
    }
    if (body?.['productIds'] !== undefined) {
      const ids = Array.isArray(body['productIds']) ? body['productIds'] : null;
      if (!ids || ids.length > 60)
        throw new BadRequestException({ errors: { productIds: 'invalid' } });
      const found = await this.prisma.client.shopProduct.findMany({
        where: {
          accountId: research.salesAccountId,
          id: { in: ids.filter((x) => typeof x === 'string') as string[] },
        },
        select: { id: true },
      });
      data.productIds = found.map((p) => p.id);
    }
    if (body?.['endsOn'] !== undefined) {
      if (body['endsOn'] !== null && !isDay(body['endsOn'])) {
        throw new BadRequestException({ errors: { endsOn: 'invalid' } });
      }
      data.endsOn = body['endsOn'] ? new Date(`${body['endsOn'] as string}T00:00:00Z`) : null;
    }
    if (body?.['directionId'] !== undefined)
      data.directionId = text(body['directionId'], 40) || null;
    if (body?.['archived'] !== undefined) data.archivedAt = body['archived'] ? new Date() : null;
    await this.prisma.client.research.update({ where: { id }, data });
    return { ok: true };
  }

  /** The sales point's active products, for choosing what the research studies. */
  @Get(':id/catalogue')
  async catalogue(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() request: { workspace: WorkspaceRequestContext },
  ) {
    const research = await this.researchOf(request.workspace, projectId, id);
    const products = await this.prisma.client.shopProduct.findMany({
      where: { accountId: research.salesAccountId, state: { not: 'removed' } },
      orderBy: { title: 'asc' },
      select: { id: true, title: true, category: true },
    });
    return { products };
  }

  /**
   * Fetches the sources again: Pinterest Trends in the markets' main regions and the Etsy market for
   * the niche's phrases. A source that fails keeps its last snapshot and says why.
   */
  @Post(':id/refresh')
  @WorkspaceRoles(...CONNECT_ROLES)
  async refresh(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() request: { workspace: WorkspaceRequestContext },
  ) {
    const ctx = request.workspace;
    const research = await this.researchOf(ctx, projectId, id);
    const project = await this.visibleProject(ctx, projectId);
    const { markets } = await this.marketsOf(project);
    const regions = pinterestRegions(markets).map((r) => r.region);
    const db = this.prisma.client;
    const save = (source: string, data: unknown, error: string | null) =>
      db.researchSnapshot.upsert({
        where: { researchId_source: { researchId: id, source } },
        create: { researchId: id, source, data: data as Prisma.InputJsonValue, error },
        update: {
          ...(error ? {} : { data: data as Prisma.InputJsonValue }),
          error,
          fetchedAt: new Date(),
        },
      });

    const pinterest = await db.socialAccount.findFirst({
      where: {
        projectId,
        workspaceId: ctx.workspaceId,
        platform: 'PINTEREST',
        hiddenAt: null,
        connection: { status: 'ACTIVE' },
      },
      select: { id: true },
    });
    const errorOf = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 300);
    const [trends, market] = await Promise.allSettled([
      pinterest
        ? fetchTrends(this.connector, pinterest.id, regions, research.keywords)
        : Promise.reject(new Error('no_pinterest')),
      fetchEtsyMarket(research.keywords),
    ]);
    await save(
      'pinterest_trends',
      trends.status === 'fulfilled' ? { regions, keywords: trends.value } : {},
      trends.status === 'rejected' ? errorOf(trends.reason) : null,
    );
    await save(
      'etsy_market',
      market.status === 'fulfilled' ? { markets: market.value } : {},
      market.status === 'rejected' ? errorOf(market.reason) : null,
    );
    await db.research.update({ where: { id }, data: { refreshedAt: new Date() } });
    return this.get(projectId, id, request);
  }

  /** A research with its sources, keyword pool and the ranking of its products. */
  @Get(':id')
  async get(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() request: { workspace: WorkspaceRequestContext },
  ) {
    const ctx = request.workspace;
    const research = await this.researchOf(ctx, projectId, id);
    const db = this.prisma.client;
    const since = new Date(Date.now() - 365 * DAY);
    const [snapshots, products, sold, account] = await Promise.all([
      db.researchSnapshot.findMany({ where: { researchId: id } }),
      db.shopProduct.findMany({
        where: { id: { in: research.productIds }, accountId: research.salesAccountId },
        select: {
          id: true,
          title: true,
          url: true,
          imageUrl: true,
          tags: true,
          views: true,
          favorers: true,
          price: true,
          currency: true,
          state: true,
        },
      }),
      research.productIds.length
        ? db.$queryRaw<{ productId: string; sold: number }[]>`
            SELECT i."productId", sum(i.quantity)::int AS sold
            FROM shop_order_item i JOIN shop_order o ON o.id = i."orderId"
            WHERE i."productId" = ANY(${research.productIds}::uuid[]) AND o."orderedAt" >= ${since}
              AND (o.status IS NULL OR lower(o.status) NOT IN ('canceled', 'cancelled', 'fully refunded'))
            GROUP BY 1`
        : Promise.resolve([] as { productId: string; sold: number }[]),
      db.socialAccount.findUnique({
        where: { id: research.salesAccountId },
        select: { platform: true, displayName: true, username: true },
      }),
    ]);
    const snapshot = (source: string) => snapshots.find((s) => s.source === source);
    const trendSnap = snapshot('pinterest_trends');
    const marketSnap = snapshot('etsy_market');
    const trends = (trendSnap?.data as { keywords?: TrendKeyword[] } | undefined)?.keywords ?? [];
    const etsy = (marketSnap?.data as { markets?: EtsyMarket[] } | undefined)?.markets ?? [];
    const soldOf = new Map(sold.map((s) => [s.productId, s.sold]));
    const studied = products.map((p) => ({
      id: p.id,
      title: p.title,
      tags: p.tags,
      views: p.views,
      favorers: p.favorers,
      sold12m: soldOf.get(p.id) ?? 0,
    }));
    const pool = keywordPool(
      trends,
      etsy,
      studied.map((p) => `${p.title} ${p.tags.join(' ')}`),
    );
    const ranking = rankProducts(studied, pool);
    const byId = new Map(products.map((p) => [p.id, p]));
    return {
      id: research.id,
      name: research.name,
      keywords: research.keywords,
      channel: research.channel,
      salesAccount: {
        id: research.salesAccountId,
        platform: account?.platform ?? null,
        name: account?.displayName ?? account?.username ?? '',
      },
      productIds: research.productIds,
      endsOn: research.endsOn ? research.endsOn.toISOString().slice(0, 10) : null,
      directionId: research.directionId,
      refreshedAt: research.refreshedAt,
      sources: {
        pinterest: trendSnap
          ? {
              fetchedAt: trendSnap.fetchedAt,
              error: trendSnap.error,
              regions: (trendSnap.data as { regions?: string[] }).regions ?? [],
              keywords: trends.length,
            }
          : null,
        etsy: marketSnap
          ? { fetchedAt: marketSnap.fetchedAt, error: marketSnap.error, markets: etsy }
          : null,
      },
      pool,
      products: ranking.map((r) => {
        const p = byId.get(r.id)!;
        return {
          ...r,
          title: p.title,
          url: p.url,
          imageUrl: p.imageUrl,
          tags: p.tags.length,
          views: p.views,
          favorers: p.favorers,
          sold12m: soldOf.get(p.id) ?? 0,
          price: p.price,
          currency: p.currency,
        };
      }),
    };
  }
}
