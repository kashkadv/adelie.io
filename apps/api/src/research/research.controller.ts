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
import { HttpException } from '@nestjs/common';
import { Prisma } from '@adelie/db';
import { Session, type UserSession } from '@thallesp/nestjs-better-auth';
import { OpenAiProvider, costMicros } from '../ai/provider.js';
import { parseBrief, todayIn } from '../calendar/ideas.js';
import { config } from '../config.js';
import { createTrackedLink } from '../links/create-link.js';
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
import {
  ADVICE_SCHEMA,
  adviceInstructions,
  checkAdvice,
  contextBlocks,
  parseAdvice,
  parseContext,
} from './advice.js';

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
      select: {
        id: true,
        markets: true,
        deliveryDays: true,
        timezone: true,
        brief: true,
      },
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

  /** The context blocks the AI gets for this research (automatic and the owner's). */
  private async blocksOf(ctx: WorkspaceRequestContext, projectId: string, id: string) {
    const research = await this.researchOf(ctx, projectId, id);
    const project = await this.visibleProject(ctx, projectId);
    const view = await this.get(projectId, id, { workspace: ctx });
    const brief = parseBrief(project.brief);
    const direction =
      brief?.directions.find((d) => d.id === research.directionId) ??
      (brief?.directions.length === 1 ? brief.directions[0] : undefined);
    const blocks = contextBlocks({
      today: todayIn(project.timezone),
      endsOn: view.endsOn,
      markets: (await this.marketsOf(project)).markets,
      deliveryDays: project.deliveryDays,
      salesPlatform: (view.salesAccount.platform as 'ETSY' | 'WEBSITE' | null) ?? null,
      channel: research.channel,
      brand: brief
        ? { about: brief.about, audience: direction?.audience ?? '', goal: direction?.goal ?? '' }
        : null,
      pool: view.pool,
      etsy: view.sources.etsy?.markets ?? [],
      context: parseContext(research.context),
    });
    return { research, view, blocks };
  }

  /** The AI's context for this research: the blocks, and the full instructions as sent. */
  @Get(':id/context')
  async context(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() request: { workspace: WorkspaceRequestContext },
  ) {
    const { blocks } = await this.blocksOf(request.workspace, projectId, id);
    return { blocks, instructions: adviceInstructions(blocks) };
  }

  /** Saves the owner's blocks and which automatic ones are off. */
  @Put(':id/context')
  @WorkspaceRoles(...CONNECT_ROLES)
  async saveContext(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @Req() request: { workspace: WorkspaceRequestContext },
  ) {
    await this.researchOf(request.workspace, projectId, id);
    const context = parseContext(body);
    await this.prisma.client.research.update({
      where: { id },
      data: { context: context as unknown as Prisma.InputJsonValue },
    });
    return this.context(projectId, id, request);
  }

  /** This month's AI spending of the project, in millionths of a dollar (ADR-0029). */
  private async spentMicros(projectId: string) {
    const now = new Date();
    const month = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const sum = await this.prisma.client.aiRun.aggregate({
      where: { projectId, createdAt: { gte: month } },
      _sum: { costMicros: true },
    });
    return sum._sum.costMicros ?? 0;
  }

  /** The last advice for each product of the research. */
  @Get(':id/advice')
  async advices(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() request: { workspace: WorkspaceRequestContext },
  ) {
    await this.researchOf(request.workspace, projectId, id);
    const rows = await this.prisma.client.researchSnapshot.findMany({
      where: { researchId: id, source: { startsWith: 'advice:' } },
      select: { source: true, data: true, fetchedAt: true },
    });
    return {
      advice: Object.fromEntries(
        rows.map((r) => [r.source.slice(7), { ...(r.data as object), createdAt: r.fetchedAt }]),
      ),
    };
  }

  /**
   * Advice for one product from the AI: title variants, 13 tags, the description's opening and two
   * pins — from the research's context; Etsy's and Pinterest's limits checked without the AI.
   */
  @Post(':id/advice')
  @WorkspaceRoles(...CONNECT_ROLES)
  async advise(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { productId?: unknown; locale?: unknown } | undefined,
    @Req() request: { workspace: WorkspaceRequestContext },
    @Session() session: UserSession,
  ) {
    const ai = config.ai;
    if (!ai) throw new HttpException({ errors: { ai: 'off' } }, 503);
    const ctx = request.workspace;
    const { research, view, blocks } = await this.blocksOf(ctx, projectId, id);
    const productId = typeof body?.productId === 'string' ? body.productId : '';
    if (!research.productIds.includes(productId)) {
      throw new BadRequestException({ errors: { productId: 'invalid' } });
    }
    if ((await this.spentMicros(projectId)) >= ai.monthlyLimitUsd * 1e6) {
      throw new HttpException({ errors: { ai: 'limit' } }, 429);
    }
    const db = this.prisma.client;
    const product = await db.shopProduct.findUniqueOrThrow({
      where: { id: productId },
      select: {
        title: true,
        details: true,
        tags: true,
        category: true,
        price: true,
        currency: true,
      },
    });
    const ranked = view.products.find((p) => p.id === productId);
    const input = [
      `Owner language: ${body?.locale === 'uk' ? 'Ukrainian' : 'English'}.`,
      'Product (JSON):',
      JSON.stringify({
        title: product.title,
        tags: product.tags,
        category: product.category,
        price: product.price !== null ? `${product.price / 100} ${product.currency ?? ''}` : null,
        // Sites keep the feed's description; Etsy's is read live by the editor, not stored.
        description:
          typeof (product.details as { description?: unknown } | null)?.description === 'string'
            ? (product.details as { description: string }).description.slice(0, 1500)
            : null,
        soldLastYear: ranked?.sold12m ?? null,
        favorites: ranked?.favorers ?? null,
        views: ranked?.views ?? null,
        poolPhrasesItHas: ranked?.matched ?? [],
        poolPhrasesItLacks: ranked?.missing ?? [],
      }),
    ].join('\n');
    const instructions = adviceInstructions(blocks);
    const provider = new OpenAiProvider(ai.apiKey, ai.model);
    const answer = await provider.structured({
      instructions,
      input,
      schema: ADVICE_SCHEMA as unknown as Record<string, unknown>,
      schemaName: 'listing_advice',
    });
    const advice = answer.ok ? parseAdvice(answer.data) : null;
    const run = await db.aiRun.create({
      data: {
        workspaceId: ctx.workspaceId,
        projectId,
        userId: session.user.id,
        kind: 'research_advice',
        provider: provider.name,
        model: answer.model,
        status: advice ? 'ok' : 'error',
        inputTokens: answer.usage.inputTokens,
        cachedTokens: answer.usage.cachedTokens,
        outputTokens: answer.usage.outputTokens,
        costMicros: costMicros(answer.usage, ai.price),
        input: { researchId: id, productId, instructions, input } as Prisma.InputJsonValue,
        output: answer.ok ? (answer.data as Prisma.InputJsonValue) : Prisma.DbNull,
        error: answer.ok ? (advice ? null : 'no valid advice') : answer.error,
      },
      select: { id: true, costMicros: true },
    });
    if (!advice) throw new HttpException({ errors: { ai: 'failed' } }, 502);
    const data = {
      ...advice,
      checks: checkAdvice(advice),
      aiRunId: run.id,
      costUsd: run.costMicros / 1e6,
    };
    await db.researchSnapshot.upsert({
      where: { researchId_source: { researchId: id, source: `advice:${productId}` } },
      create: {
        researchId: id,
        source: `advice:${productId}`,
        data: data as Prisma.InputJsonValue,
      },
      update: { data: data as Prisma.InputJsonValue, error: null, fetchedAt: new Date() },
    });
    return { ...data, createdAt: new Date() };
  }

  /**
   * A pin for a product into the calendar: a tracked Pinterest link to the product's page
   * (campaign = the research) and a draft pin on the chosen day carrying it.
   */
  @Post(':id/pin')
  @WorkspaceRoles(...CONNECT_ROLES)
  async pin(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body()
    body:
      { productId?: unknown; title?: unknown; description?: unknown; date?: unknown } | undefined,
    @Req() request: { workspace: WorkspaceRequestContext },
  ) {
    const ctx = request.workspace;
    const research = await this.researchOf(ctx, projectId, id);
    const productId = typeof body?.productId === 'string' ? body.productId : '';
    const title = text(body?.title, 200);
    const description = text(body?.description, 2000);
    const date = body?.date === null || body?.date === undefined ? null : body.date;
    if (!research.productIds.includes(productId)) {
      throw new BadRequestException({ errors: { productId: 'invalid' } });
    }
    if (!title) throw new BadRequestException({ errors: { title: 'invalid' } });
    if (date !== null && !isDay(date))
      throw new BadRequestException({ errors: { date: 'invalid' } });
    const db = this.prisma.client;
    const product = await db.shopProduct.findUniqueOrThrow({
      where: { id: productId },
      select: { url: true, title: true },
    });
    if (!product.url) throw new BadRequestException({ errors: { productId: 'noUrl' } });
    const created = await createTrackedLink(
      db,
      { workspaceId: ctx.workspaceId, projectId },
      {
        destination: product.url,
        channel: 'pinterest',
        campaign: research.name,
        name: `${product.title.slice(0, 80)} · Pinterest`,
      },
    );
    if (!created.ok) throw new BadRequestException({ errors: { link: created.error } });
    const day = date ? new Date(`${date as string}T00:00:00Z`) : null;
    const last = await db.calendarItem.aggregate({
      where: { projectId, suggestion: null, date: day },
      _max: { position: true },
    });
    const item = await db.calendarItem.create({
      data: {
        workspaceId: ctx.workspaceId,
        projectId,
        date: day,
        position: (last._max.position ?? -1) + 1,
        channel: 'pinterest',
        format: 'pin',
        title,
        notes: description || null,
        minutes: 15,
        status: 'draft',
        linkId: created.link.id,
      },
      select: { id: true },
    });
    return { itemId: item.id, linkId: created.link.id, code: created.link.code };
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
