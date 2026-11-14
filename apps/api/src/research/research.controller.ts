import {
  Query,
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
import { researchResult } from './result.js';
import { auditTags, OK, STRONG } from './tag-audit.js';
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
  phraseKey,
  rankProducts,
  rateTags,
  suggestProducts,
  tagCandidates,
  type TagStat,
  type EtsyMarket,
  type TrendKeyword,
} from './research.js';
import { fetchEtsyMarket, fetchTagStats, fetchTrends } from './sources.js';
import {
  POOL_INSTRUCTIONS,
  POOL_SCHEMA,
  SEEDS_INSTRUCTIONS,
  SEEDS_SCHEMA,
  parseOverrides,
  parsePoolReview,
  parseSeeds,
  phraseVisible,
  type PoolReview,
} from './phrases-ai.js';
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

  /**
   * A research's rated tags for one version (the latest unless named): the pool as the AI and the
   * owner left it, the tags rated against the niche (ADR-0034). Shared by what a product shows.
   */
  private async ratingOf(
    research: { id: string; productIds: string[]; salesAccountId: string; context: unknown },
    versionId?: string,
  ) {
    const db = this.prisma.client;
    const [version, studiedData] = await Promise.all([
      db.researchVersion.findFirst({
        where: { researchId: research.id, ...(versionId ? { id: versionId } : {}) },
        orderBy: { createdAt: 'desc' },
      }),
      this.studied(research),
    ]);
    const { products, studied } = studiedData;
    const trends = ((version?.trends ?? {}) as { keywords?: TrendKeyword[] }).keywords ?? [];
    const etsy = ((version?.market ?? {}) as { markets?: EtsyMarket[] }).markets ?? [];
    const tagStats = ((version?.tags ?? {}) as { tags?: TagStat[] }).tags ?? [];
    const ownTexts = studied.map((p) => `${p.title} ${p.tags.join(' ')}`);
    const pool = keywordPool(trends, etsy, ownTexts);
    const review = ((version?.review as { review?: PoolReview } | null)?.review ??
      {}) as PoolReview;
    const overrides = parseOverrides((research.context as { phrases?: unknown } | null)?.phrases);
    const isVisible = (phrase: string) => phraseVisible(phrase, review, overrides);
    const prices = products
      .filter((p) => p.price !== null && (p.currency ?? 'USD') === 'USD')
      .map((p) => p.price! / 100)
      .sort((a, b) => a - b);
    const ownPrice = prices.length ? prices[Math.floor(prices.length / 2)]! : null;
    const rated = rateTags(tagStats, pool, ownTexts, ownPrice).filter((t) => isVisible(t.tag));
    const ratedOf = new Map(rated.map((t) => [phraseKey(t.tag), t]));
    return { version, rated, ratedOf, isVisible };
  }

  /** A product's tags audited, with the figures behind each (for the tooltips). */
  private auditOf(tags: string[], rating: Awaited<ReturnType<ResearchController['ratingOf']>>) {
    const audit = auditTags(tags, rating.ratedOf, rating.rated, rating.isVisible);
    const details: Record<string, unknown> = {};
    for (const tag of [...tags, ...audit.replacements.map((r) => r.tag)]) {
      const r = rating.ratedOf.get(phraseKey(tag));
      if (r) {
        details[tag] = {
          competition: r.competition,
          count: r.count,
          avgFavorers: r.avgFavorers,
          pinterestMom: r.pinterestMom,
          priceVsOwn: r.priceVsOwn,
        };
      }
    }
    return { audit, details };
  }

  /**
   * What the research says about one product (the product card and the editor, ADR-0035): its tags
   * audited against the latest rated tags, replacements, and the last advice of the AI. The research
   * is the freshest one that studies the product, unless another is named.
   */
  @Get('for-product/:productId')
  async forProduct(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('productId', ParseUUIDPipe) productId: string,
    @Req() request: { workspace: WorkspaceRequestContext },
    @Query('researchId') researchId?: string,
  ) {
    const ctx = request.workspace;
    await this.visibleProject(ctx, projectId);
    const db = this.prisma.client;
    const product = await db.shopProduct.findFirst({
      where: { id: productId, projectId, workspaceId: ctx.workspaceId },
      select: { tags: true },
    });
    if (!product) throw new NotFoundException();
    const researches = await db.research.findMany({
      where: { projectId, workspaceId: ctx.workspaceId, productIds: { has: productId } },
      orderBy: [{ refreshedAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
      select: { id: true, name: true, refreshedAt: true },
    });
    const chosen = researches.find((r) => r.id === researchId) ?? researches[0];
    if (!chosen) return { researches: [], research: null };
    const research = await db.research.findUniqueOrThrow({ where: { id: chosen.id } });
    const rating = await this.ratingOf(research);
    const snapshot = await db.researchSnapshot.findUnique({
      where: { researchId_source: { researchId: research.id, source: `advice:${productId}` } },
      select: { data: true, fetchedAt: true },
    });
    return {
      researches,
      research: {
        id: research.id,
        name: research.name,
        refreshedAt: research.refreshedAt,
        version: rating.version
          ? { id: rating.version.id, createdAt: rating.version.createdAt }
          : null,
      },
      thresholds: { strong: STRONG, ok: OK },
      ...(rating.version ? this.auditOf(product.tags, rating) : { audit: null, details: {} }),
      advice: snapshot ? { ...(snapshot.data as object), createdAt: snapshot.fetchedAt } : null,
    };
  }

  /** The audit of tags as the editor holds them now (they are not saved yet). */
  @Post('for-product/:productId/check')
  async checkTags(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('productId', ParseUUIDPipe) productId: string,
    @Body() body: { researchId?: unknown; tags?: unknown } | undefined,
    @Req() request: { workspace: WorkspaceRequestContext },
  ) {
    const ctx = request.workspace;
    await this.visibleProject(ctx, projectId);
    const tags = body?.tags;
    if (
      !Array.isArray(tags) ||
      tags.length > 30 ||
      tags.some((t) => typeof t !== 'string' || t.length > 60)
    ) {
      throw new BadRequestException({ errors: { tags: 'invalid' } });
    }
    const db = this.prisma.client;
    const research = await db.research.findFirst({
      where: {
        id: typeof body?.researchId === 'string' ? body.researchId : '',
        projectId,
        workspaceId: ctx.workspaceId,
        productIds: { has: productId },
      },
    });
    if (!research) throw new NotFoundException();
    const rating = await this.ratingOf(research);
    if (!rating.version) return { audit: null, details: {} };
    return this.auditOf(tags as string[], rating);
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
    // The owner's word on a pool phrase: hide it, keep it against the AI, or give it back to the AI.
    const phrase = typeof body?.['phrase'] === 'string' ? phraseKey(body['phrase']) : '';
    const act = body?.['phraseAction'];
    if (phrase && (act === 'hide' || act === 'keep' || act === 'reset')) {
      const context = (research.context ?? {}) as Record<string, unknown>;
      const o = parseOverrides(context['phrases']);
      const hidden = o.hidden.filter((x) => x !== phrase);
      const kept = o.kept.filter((x) => x !== phrase);
      if (act === 'hide') hidden.push(phrase);
      if (act === 'keep') kept.push(phrase);
      data.context = { ...context, phrases: { hidden, kept } } as Prisma.InputJsonValue;
    }
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
    @Session() session: UserSession,
  ) {
    await this.researchOf(request.workspace, projectId, id);
    // It takes a while (dozens of Etsy requests): it runs on in the background, the page asks again.
    if (!this.running.has(id)) {
      this.running.set(
        id,
        this.collect(projectId, id, request, session)
          .then(() => this.failed.delete(id))
          .catch((e: unknown) => this.failed.set(id, e instanceof Error ? e.message : String(e)))
          .finally(() => this.running.delete(id)),
      );
    }
    return { running: true };
  }

  /** Researches being refreshed now, and the last refresh that failed (by research id). */
  private readonly running = new Map<string, Promise<unknown>>();
  private readonly failed = new Map<string, string>();

  /** One refresh: sources, the pool's review, the tags' numbers — saved as a new version. */
  private async collect(
    projectId: string,
    id: string,
    request: { workspace: WorkspaceRequestContext },
    session: UserSession,
  ) {
    const ctx = request.workspace;
    const research = await this.researchOf(ctx, projectId, id);
    const project = await this.visibleProject(ctx, projectId);
    const { markets } = await this.marketsOf(project);
    const regions = pinterestRegions(markets).map((r) => r.region);
    const db = this.prisma.client;
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
    const trendList = trends.status === 'fulfilled' ? trends.value : [];
    const marketList = market.status === 'fulfilled' ? market.value : [];

    // The pool of this version, reviewed by the AI at once (when available and within the limit).
    const { studied } = await this.studied(research);
    const pool = keywordPool(
      trendList,
      marketList,
      studied.map((p) => `${p.title} ${p.tags.join(' ')}`),
    );
    // Phrases reviewed in an earlier version keep their verdict; only new ones go to the AI.
    const previous = await db.researchVersion.findFirst({
      where: { researchId: id, review: { not: Prisma.DbNull } },
      orderBy: { createdAt: 'desc' },
      select: { review: true },
    });
    const known = ((previous?.review as { review?: PoolReview } | null)?.review ??
      {}) as PoolReview;
    const fresh = pool.map((p) => p.phrase).filter((p) => !known[phraseKey(p)]);
    const added = fresh.length
      ? await this.reviewPhrases(ctx, session.user.id, project, research, fresh).catch(() => null)
      : {};
    const review: PoolReview | null =
      added || Object.keys(known).length ? { ...known, ...added } : null;
    const overrides = parseOverrides((research.context as { phrases?: unknown } | null)?.phrases);
    const visible = pool.filter((p) => phraseVisible(p.phrase, review ?? {}, overrides));

    // Etsy's numbers for the candidate tags: the pool's best and the tags the products already use.
    const productTags = studied.flatMap((p) => p.tags.map((t) => t.toLowerCase().trim()));
    const candidates = [
      ...new Set([
        ...tagCandidates(visible, 30),
        ...productTags.filter((t) => t && t.length <= 20),
      ]),
    ].slice(0, 80);
    const tagStats = await fetchTagStats(candidates).then(
      (tags) => ({ tags }),
      (e: unknown) => ({ error: errorOf(e) }),
    );

    await db.researchVersion.create({
      data: {
        researchId: id,
        keywords: research.keywords,
        trends: (trends.status === 'fulfilled'
          ? { regions, keywords: trendList }
          : { error: errorOf(trends.reason) }) as Prisma.InputJsonValue,
        market: (market.status === 'fulfilled'
          ? { markets: marketList }
          : { error: errorOf(market.reason) }) as Prisma.InputJsonValue,
        tags: tagStats as Prisma.InputJsonValue,
        review: review ? ({ review } as Prisma.InputJsonValue) : Prisma.DbNull,
      },
    });
    await db.research.update({ where: { id }, data: { refreshedAt: new Date() } });
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
      pool: view.pool.filter((p) => p.visible),
      etsy: view.sources.etsy?.markets ?? [],
      tags: view.tags,
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
    const research = await this.researchOf(request.workspace, projectId, id);
    const context = parseContext(body);
    await this.prisma.client.research.update({
      where: { id },
      data: {
        context: {
          ...context,
          phrases: (research.context as { phrases?: unknown } | null)?.phrases ?? null,
        } as unknown as Prisma.InputJsonValue,
      },
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

  /**
   * One structured AI request for a research (ADR-0029 rules): the project's monthly limit, the
   * request logged with its cost. Null when AI is off, over the limit or the answer is unusable.
   */
  private async ai(
    ctx: WorkspaceRequestContext,
    projectId: string,
    userId: string,
    kind: string,
    request: { instructions: string; input: string; schema: Record<string, unknown>; name: string },
  ): Promise<
    { ok: true; data: unknown; costUsd: number } | { ok: false; error: 'off' | 'limit' | 'failed' }
  > {
    const ai = config.ai;
    if (!ai) return { ok: false, error: 'off' };
    if ((await this.spentMicros(projectId)) >= ai.monthlyLimitUsd * 1e6)
      return { ok: false, error: 'limit' };
    const provider = new OpenAiProvider(ai.apiKey, ai.model);
    const answer = await provider.structured({
      instructions: request.instructions,
      input: request.input,
      schema: request.schema,
      schemaName: request.name,
    });
    const run = await this.prisma.client.aiRun.create({
      data: {
        workspaceId: ctx.workspaceId,
        projectId,
        userId,
        kind,
        provider: provider.name,
        model: answer.model,
        status: answer.ok ? 'ok' : 'error',
        inputTokens: answer.usage.inputTokens,
        cachedTokens: answer.usage.cachedTokens,
        outputTokens: answer.usage.outputTokens,
        costMicros: costMicros(answer.usage, ai.price),
        input: {
          instructions: request.instructions,
          input: request.input,
        } as Prisma.InputJsonValue,
        output: answer.ok ? (answer.data as Prisma.InputJsonValue) : Prisma.DbNull,
        error: answer.ok ? null : answer.error,
      },
      select: { costMicros: true },
    });
    return answer.ok
      ? { ok: true, data: answer.data, costUsd: run.costMicros / 1e6 }
      : { ok: false, error: 'failed' };
  }

  private aiError(error: 'off' | 'limit' | 'failed'): never {
    throw new HttpException(
      { errors: { ai: error } },
      error === 'off' ? 503 : error === 'limit' ? 429 : 502,
    );
  }

  /** What the AI needs to know about the brand and its products to judge phrases. */
  private async nicheInput(
    project: { brief: unknown; markets: unknown; id: string },
    salesAccountId: string,
    keywords: string[],
    productIds: string[] | null,
  ) {
    const db = this.prisma.client;
    const catalogue = await db.shopProduct.findMany({
      where: { accountId: salesAccountId, state: 'active' },
      orderBy: { favorers: { sort: 'desc', nulls: 'last' } },
      select: { id: true, title: true, tags: true, category: true },
      take: 400,
    });
    const chosen = productIds
      ? catalogue.filter((p) => productIds.includes(p.id))
      : suggestProducts(catalogue, keywords, 15);
    const sample = (chosen.length ? chosen : catalogue).slice(0, 15);
    const brief = parseBrief(project.brief);
    const { markets } = await this.marketsOf(project);
    return {
      brand: brief?.about ?? '',
      markets: markets.map((m) => `${m.code} ${m.share}%`),
      products: sample.map((p) => ({
        title: p.title,
        tags: p.tags.slice(0, 13),
        category: p.category,
      })),
    };
  }

  /** Better seed phrases for a niche, before a research exists (from the "new research" form). */
  @Post('seeds')
  @WorkspaceRoles(...CONNECT_ROLES)
  async seedsNew(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body()
    body:
      | { name?: unknown; keywords?: unknown; salesAccountId?: unknown; locale?: unknown }
      | undefined,
    @Req() request: { workspace: WorkspaceRequestContext },
    @Session() session: UserSession,
  ) {
    const ctx = request.workspace;
    const project = await this.visibleProject(ctx, projectId);
    const sales = await this.salesAccounts(projectId, ctx.workspaceId);
    const account = sales.find((a) => a.id === body?.salesAccountId);
    if (!account) throw new BadRequestException({ errors: { salesAccountId: 'invalid' } });
    return this.seeds(
      ctx,
      session.user.id,
      project,
      account.id,
      text(body?.name, 100),
      parseKeywords(body?.keywords) ?? [],
      null,
      body?.locale,
    );
  }

  /** Better seed phrases for an existing research. */
  @Post(':id/seeds')
  @WorkspaceRoles(...CONNECT_ROLES)
  async seedsOf(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { keywords?: unknown; locale?: unknown } | undefined,
    @Req() request: { workspace: WorkspaceRequestContext },
    @Session() session: UserSession,
  ) {
    const ctx = request.workspace;
    const research = await this.researchOf(ctx, projectId, id);
    const project = await this.visibleProject(ctx, projectId);
    return this.seeds(
      ctx,
      session.user.id,
      project,
      research.salesAccountId,
      research.name,
      parseKeywords(body?.keywords) ?? research.keywords,
      research.productIds,
      body?.locale,
    );
  }

  private async seeds(
    ctx: WorkspaceRequestContext,
    userId: string,
    project: { brief: unknown; markets: unknown; id: string },
    salesAccountId: string,
    name: string,
    keywords: string[],
    productIds: string[] | null,
    locale: unknown,
  ) {
    const niche = await this.nicheInput(project, salesAccountId, keywords, productIds);
    const result = await this.ai(ctx, project.id, userId, 'research_seeds', {
      instructions: SEEDS_INSTRUCTIONS,
      input: [
        `Owner language: ${locale === 'uk' ? 'Ukrainian' : 'English'}.`,
        JSON.stringify({ research: name, ownerPhrases: keywords, ...niche }),
      ].join('\n'),
      schema: SEEDS_SCHEMA as unknown as Record<string, unknown>,
      name: 'research_seeds',
    });
    if (!result.ok) this.aiError(result.error);
    const seeds = parseSeeds(result.data);
    if (!seeds) this.aiError('failed');
    return { ...seeds, costUsd: result.costUsd };
  }

  /**
   * The AI's review of the keyword pool: each phrase relevant, too general, another product or
   * style, or another intent. Kept as a snapshot; the owner's word still wins over it.
   */
  @Post(':id/review')
  @WorkspaceRoles(...CONNECT_ROLES)
  async reviewPool(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() request: { workspace: WorkspaceRequestContext },
    @Session() session: UserSession,
  ) {
    const ctx = request.workspace;
    const research = await this.researchOf(ctx, projectId, id);
    const project = await this.visibleProject(ctx, projectId);
    const latest = await this.prisma.client.researchVersion.findFirst({
      where: { researchId: id },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });
    if (!latest) return { reviewed: 0 };
    const view = await this.get(projectId, id, request, latest.id);
    const review = await this.reviewPhrases(
      ctx,
      session.user.id,
      project,
      research,
      view.pool.map((p) => p.phrase),
    );
    await this.prisma.client.researchVersion.update({
      where: { id: latest.id },
      data: { review: { review } as Prisma.InputJsonValue },
    });
    return { reviewed: Object.keys(review).length };
  }

  /** The AI's verdict on each phrase (relevant, generic, another product, another intent). */
  private async reviewPhrases(
    ctx: WorkspaceRequestContext,
    userId: string,
    project: { brief: unknown; markets: unknown; id: string },
    research: { name: string; keywords: string[]; salesAccountId: string; productIds: string[] },
    phrases: string[],
  ): Promise<PoolReview> {
    if (!phrases.length) return {};
    const niche = await this.nicheInput(
      project,
      research.salesAccountId,
      research.keywords,
      research.productIds,
    );
    const result = await this.ai(ctx, project.id, userId, 'research_pool_review', {
      instructions: POOL_INSTRUCTIONS,
      input: JSON.stringify({
        research: research.name,
        niche: research.keywords,
        ...niche,
        phrases,
      }),
      schema: POOL_SCHEMA as unknown as Record<string, unknown>,
      name: 'pool_review',
    });
    if (!result.ok) this.aiError(result.error);
    return parsePoolReview(result.data, phrases);
  }

  /**
   * The research's result (ADR-0036): its changed products before and after their changes from the
   * editor, against the unchanged ones over the same days — views and favourites a day, and sales.
   */
  @Get(':id/result')
  async result(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() request: { workspace: WorkspaceRequestContext },
  ) {
    const ctx = request.workspace;
    const research = await this.researchOf(ctx, projectId, id);
    const project = await this.visibleProject(ctx, projectId);
    const ids = research.productIds;
    const db = this.prisma.client;
    const since = new Date(Date.now() - 120 * DAY);
    const [daily, changes, sales] = ids.length
      ? await Promise.all([
          db.shopProductDaily.findMany({
            where: { productId: { in: ids }, date: { gte: since } },
            orderBy: { date: 'asc' },
            select: { productId: true, date: true, views: true, favorers: true },
          }),
          db.shopProductChange.findMany({
            where: { productId: { in: ids }, status: 'applied', createdAt: { gte: since } },
            select: { productId: true, createdAt: true, changes: true },
          }),
          db.$queryRaw<{ productId: string; date: string; quantity: number }[]>`
            SELECT i."productId", to_char(o."orderedAt", 'YYYY-MM-DD') AS date, sum(i.quantity)::int AS quantity
            FROM shop_order_item i JOIN shop_order o ON o.id = i."orderId"
            WHERE i."productId" = ANY(${ids}::uuid[]) AND o."orderedAt" >= ${since}
              AND (o.status IS NULL OR lower(o.status) NOT IN ('canceled', 'cancelled', 'fully refunded'))
            GROUP BY 1, 2`,
        ])
      : [[], [], []];
    const day = (d: Date) => d.toISOString().slice(0, 10);
    return researchResult(
      ids.map((pid) => ({
        id: pid,
        daily: daily
          .filter((d) => d.productId === pid)
          .map((d) => ({ date: day(d.date), views: d.views, favorers: d.favorers })),
        changes: changes
          .filter((c) => c.productId === pid)
          .map((c) => ({
            date: todayIn(project.timezone, c.createdAt),
            fields: Object.keys((c.changes ?? {}) as object),
          })),
        sales: sales
          .filter((x) => x.productId === pid)
          .map((x) => ({ date: x.date, quantity: x.quantity })),
      })),
      todayIn(project.timezone),
    );
  }

  /**
   * A research as of one version (the latest unless `version` names another): its sources, the
   * keyword pool with the AI's review, rated tags, the ranking of its products with their tags'
   * audit; and the list of versions.
   */
  @Get(':id')
  async get(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() request: { workspace: WorkspaceRequestContext },
    @Query('version') versionId?: string,
  ) {
    const ctx = request.workspace;
    const research = await this.researchOf(ctx, projectId, id);
    const db = this.prisma.client;
    const [versions, studiedData, account] = await Promise.all([
      db.researchVersion.findMany({
        where: { researchId: id },
        orderBy: { createdAt: 'desc' },
        select: { id: true, createdAt: true, keywords: true },
        take: 100,
      }),
      this.studied(research),
      db.socialAccount.findUnique({
        where: { id: research.salesAccountId },
        select: { platform: true, displayName: true, username: true },
      }),
    ]);
    const chosen = versions.find((v) => v.id === versionId) ?? versions[0];
    const version = chosen
      ? await db.researchVersion.findUniqueOrThrow({ where: { id: chosen.id } })
      : null;
    const { products, studied, soldOf } = studiedData;
    const trendsData = (version?.trends ?? {}) as {
      regions?: string[];
      keywords?: TrendKeyword[];
      error?: string;
    };
    const marketData = (version?.market ?? {}) as { markets?: EtsyMarket[]; error?: string };
    const tagsData = (version?.tags ?? {}) as { tags?: TagStat[]; error?: string };
    const trends = trendsData.keywords ?? [];
    const etsy = marketData.markets ?? [];
    const ownTexts = studied.map((p) => `${p.title} ${p.tags.join(' ')}`);
    const pool = keywordPool(trends, etsy, ownTexts);
    // The AI's review of the pool and the owner's word decide what is shown (ADR-0033).
    const review = ((version?.review as { review?: PoolReview } | null)?.review ??
      {}) as PoolReview;
    const overrides = parseOverrides((research.context as { phrases?: unknown } | null)?.phrases);
    const isVisible = (phrase: string) => phraseVisible(phrase, review, overrides);
    const visible = pool.filter((p) => isVisible(p.phrase));
    const ranking = rankProducts(studied, visible);
    const prices = products
      .filter((p) => p.price !== null && (p.currency ?? 'USD') === 'USD')
      .map((p) => p.price! / 100)
      .sort((a, b) => a - b);
    const ownPrice = prices.length ? prices[Math.floor(prices.length / 2)]! : null;
    const rated = rateTags(tagsData.tags ?? [], pool, ownTexts, ownPrice).filter((t) =>
      isVisible(t.tag),
    );
    const ratedOf = new Map(rated.map((t) => [phraseKey(t.tag), t]));
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
      refreshing: this.running.has(id),
      refreshError: this.failed.get(id) ?? null,
      versions: versions.map((v) => ({ id: v.id, createdAt: v.createdAt, keywords: v.keywords })),
      version: version
        ? { id: version.id, createdAt: version.createdAt, keywords: version.keywords }
        : null,
      sources: {
        pinterest: version
          ? {
              fetchedAt: version.createdAt,
              error: trendsData.error ?? null,
              regions: trendsData.regions ?? [],
              keywords: trends.length,
            }
          : null,
        etsy: version
          ? { fetchedAt: version.createdAt, error: marketData.error ?? null, markets: etsy }
          : null,
      },
      pool: pool.map((p) => ({
        ...p,
        verdict: review[phraseKey(p.phrase)]?.verdict ?? null,
        why: review[phraseKey(p.phrase)]?.why ?? null,
        visible: isVisible(p.phrase),
        byOwner: overrides.hidden.includes(p.phrase)
          ? 'hidden'
          : overrides.kept.includes(p.phrase)
            ? 'kept'
            : null,
      })),
      reviewedAt: version?.review ? version.createdAt : null,
      tags: rated,
      tagsError: tagsData.error ?? null,
      ownPrice,
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
          tagAudit: auditTags(p.tags, ratedOf, rated, (t) => isVisible(t)),
        };
      }),
    };
  }

  /** The research's products with their sales of the last year. */
  private async studied(research: { productIds: string[]; salesAccountId: string }) {
    const db = this.prisma.client;
    const since = new Date(Date.now() - 365 * DAY);
    const [products, sold] = await Promise.all([
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
    ]);
    const soldOf = new Map(sold.map((s) => [s.productId, s.sold]));
    const studied = products.map((p) => ({
      id: p.id,
      title: p.title,
      tags: p.tags,
      views: p.views,
      favorers: p.favorers,
      sold12m: soldOf.get(p.id) ?? 0,
    }));
    return { products, studied, soldOf };
  }
}
