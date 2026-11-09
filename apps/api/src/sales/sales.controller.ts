import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  HttpException,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Delete,
  Query,
  Req,
  UnprocessableEntityException,
  UseGuards,
} from '@nestjs/common';
import type { Prisma } from '@adelie/db';
import {
  analyzePage,
  articlesOf,
  FeedFetchError,
  fetchPage,
  isAdapterError,
  productKeys,
  productChangeErrors,
  skuStructure,
  type ProductChanges,
  type ProductEditable,
} from '@adelie/platforms';
import { Session, type UserSession } from '@thallesp/nestjs-better-auth';
import { CONNECT_ROLES, ConnectService, accessOf } from '../social/connect.service.js';
import { PrismaService } from '../prisma.service.js';
import { orderAccounts } from '../social/account-order.js';
import { visibleProjectsWhere } from '../workspaces/project-visibility.js';
import {
  WorkspaceAccessGuard,
  WorkspaceRoles,
  type WorkspaceRequestContext,
} from '../workspaces/workspace-access.guard.js';
import { countsAsSale, monthlySales, moneyFlow, netRevenue, ordersByDay } from './sales.js';
import { ISSUE_CODES, productIssues, type Issue } from './product-issues.js';

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;
const asDate = (d: string) => new Date(`${d}T00:00:00Z`);
const PAGE_SIZE = 50;

/** Shops of the project that are shown: not hidden, not disconnected (their history is kept). */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Shops and sites (a catalogue: products, no orders), for the Products page. */
const CATALOG_WHERE = {
  platform: { in: ['ETSY', 'WEBSITE'] },
  hiddenAt: null,
  connection: { status: { not: 'REVOKED' } },
} satisfies Prisma.SocialAccountWhereInput;

const SHOP_WHERE = {
  platform: 'ETSY',
  hiddenAt: null,
  connection: { status: { not: 'REVOKED' } },
} satisfies Prisma.SocialAccountWhereInput;

/**
 * Sales (ADR-0018): products and orders of the project's shops. Money is integer minor units of
 * each order's currency; revenue never includes the sales tax the platform collects for the state.
 */
@Controller('workspaces/:workspaceId/projects/:projectId/sales')
@UseGuards(WorkspaceAccessGuard)
export class SalesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly connector: ConnectService,
  ) {}

  /** A product of a visible project's shop, with what is needed to edit it. */
  private async editableProduct(
    ctx: WorkspaceRequestContext,
    projectId: string,
    productId: string,
  ) {
    await this.visibleProject(ctx, projectId);
    const product = await this.prisma.client.shopProduct.findFirst({
      where: { id: productId, projectId, workspaceId: ctx.workspaceId, account: SHOP_WHERE },
      select: {
        id: true,
        externalId: true,
        title: true,
        imageUrl: true,
        url: true,
        state: true,
        accountId: true,
        account: {
          select: { platform: true, connection: { select: { status: true, scopes: true } } },
        },
      },
    });
    if (!product) throw new NotFoundException();
    const access = accessOf(product.account.platform, product.account.connection.scopes);
    // Why a product cannot be edited here, or null when it can.
    const reason = !(CONNECT_ROLES as readonly string[]).includes(ctx.role)
      ? 'role'
      : product.account.connection.status !== 'ACTIVE'
        ? 'connection'
        : access !== 'write'
          ? 'readOnly'
          : product.state === 'removed'
            ? 'removed'
            : null;
    return { product, reason };
  }

  private history(productId: string) {
    return this.prisma.client.shopProductChange.findMany({
      where: { productId },
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: {
        id: true,
        changes: true,
        status: true,
        error: true,
        createdAt: true,
        user: { select: { name: true } },
      },
    });
  }

  /**
   * One order in full: its lines with their products, the amounts, and what stayed with the shop —
   * the ledger entries tied to the receipt, its lines and its payments (the payment ids come live
   * from the platform; without them the card shows fees only).
   */
  @Get('orders/:orderId')
  async order(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Req() request: { workspace: WorkspaceRequestContext },
  ) {
    await this.visibleProject(request.workspace, projectId);
    const db = this.prisma.client;
    const order = await db.shopOrder.findFirst({
      where: {
        id: orderId,
        projectId,
        workspaceId: request.workspace.workspaceId,
        account: SHOP_WHERE,
      },
      select: {
        id: true,
        externalId: true,
        accountId: true,
        orderedAt: true,
        status: true,
        isPaid: true,
        isShipped: true,
        currency: true,
        total: true,
        subtotal: true,
        shipping: true,
        tax: true,
        discount: true,
        country: true,
        account: { select: { username: true, displayName: true, platform: true } },
        items: {
          select: {
            id: true,
            externalId: true,
            title: true,
            quantity: true,
            price: true,
            product: { select: { id: true, title: true, imageUrl: true, url: true, state: true } },
          },
        },
      },
    });
    if (!order) throw new NotFoundException();

    const paymentIds: string[] = await this.connector
      .withAccount(order.accountId, (adapter, ctx) =>
        adapter.getOrderPaymentIds
          ? adapter.getOrderPaymentIds(ctx, order.externalId)
          : Promise.resolve([]),
      )
      .catch(() => []);
    const ledger = await db.shopLedgerEntry.findMany({
      where: {
        accountId: order.accountId,
        referenceId: {
          in: [order.externalId, ...order.items.map((i) => i.externalId), ...paymentIds],
        },
      },
      orderBy: { occurredAt: 'asc' },
      select: {
        id: true,
        type: true,
        category: true,
        amount: true,
        currency: true,
        occurredAt: true,
      },
    });
    const paid = ledger.some((e) => e.category === 'sales');
    const { externalId, accountId: _accountId, items, ...rest } = order;
    return {
      ...rest,
      number: externalId,
      // The order in the seller's Etsy dashboard.
      sellerUrl: `https://www.etsy.com/your/orders/sold?order_id=${externalId}`,
      revenue: netRevenue(order),
      items: items.map(({ externalId: _id, ...i }) => i),
      ledger: ledger.filter((e) => e.category !== 'payout'),
      // What stayed with the shop: only when the payment itself is among the entries.
      net: paid
        ? ledger.filter((e) => e.category !== 'payout').reduce((n, e) => n + e.amount, 0)
        : null,
    };
  }

  /**
   * One product in full: our copy of it, its sales (all time, and per month for a year), its
   * latest orders, and the posts (pins) that lead to it.
   */
  @Get('products/:productId')
  async product(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('productId', ParseUUIDPipe) productId: string,
    @Req() request: { workspace: WorkspaceRequestContext },
  ) {
    await this.visibleProject(request.workspace, projectId);
    const db = this.prisma.client;
    const product = await db.shopProduct.findFirst({
      where: {
        id: productId,
        projectId,
        workspaceId: request.workspace.workspaceId,
        account: CATALOG_WHERE,
      },
      select: {
        id: true,
        externalId: true,
        title: true,
        url: true,
        imageUrl: true,
        state: true,
        price: true,
        currency: true,
        quantity: true,
        views: true,
        favorers: true,
        tags: true,
        skus: true,
        articles: true,
        details: true,
        skuBy: true,
        skuGroups: true,
        twinGroupId: true,
        listedAt: true,
        updatedAt: true,
        account: { select: { id: true, username: true, displayName: true, platform: true } },
      },
    });
    if (!product) throw new NotFoundException();

    const [lines, posts] = await Promise.all([
      db.shopOrderItem.findMany({
        where: { productId },
        orderBy: { order: { orderedAt: 'desc' } },
        select: {
          id: true,
          quantity: true,
          price: true,
          order: { select: { orderedAt: true, country: true, currency: true, status: true } },
        },
      }),
      db.socialPost.findMany({
        where: {
          projectId,
          workspaceId: request.workspace.workspaceId,
          links: {
            some: {
              key: {
                in: productKeys({
                  platform: product.account.platform,
                  externalId: product.externalId,
                  url: product.url,
                }),
              },
            },
          },
          account: { hiddenAt: null, connection: { status: { not: 'REVOKED' } } },
        },
        orderBy: { publishedAt: { sort: 'desc', nulls: 'last' } },
        select: {
          id: true,
          title: true,
          thumbnailUrl: true,
          url: true,
          publishedAt: true,
          account: { select: { platform: true } },
          latest: { select: { impressions: true, saves: true, outboundClicks: true } },
        },
      }),
    ]);
    // Canceled and fully refunded orders are not sales.
    const sold = lines.filter((l) => countsAsSale(l.order.status));
    const flat = sold.map((l) => ({ ...l, orderedAt: l.order.orderedAt }));
    // Twins: listings that are the same product. Suggested: other active listings with exactly the
    // same SKUs. Candidates: every other listing, for choosing one by hand.
    const twinSelect = { id: true, title: true, imageUrl: true, state: true, skus: true } as const;
    const inShop = { projectId, workspaceId: request.workspace.workspaceId, account: SHOP_WHERE };
    const isShop = product.account.platform === 'ETSY';
    const [twins, sameSkus, candidates] = await Promise.all([
      isShop && product.twinGroupId
        ? db.shopProduct.findMany({
            where: { ...inShop, twinGroupId: product.twinGroupId, id: { not: productId } },
            select: twinSelect,
            orderBy: { title: 'asc' },
          })
        : Promise.resolve([]),
      isShop && product.skus.length
        ? db.shopProduct.findMany({
            where: {
              ...inShop,
              id: { not: productId },
              state: 'active',
              skus: { hasSome: product.skus },
            },
            select: { ...twinSelect, twinGroupId: true },
          })
        : Promise.resolve([]),
      isShop
        ? db.shopProduct.findMany({
            where: { ...inShop, id: { not: productId }, state: { not: 'removed' } },
            select: { id: true, title: true, state: true },
            orderBy: { title: 'asc' },
            take: 1000,
          })
        : Promise.resolve([]),
    ]);
    // The history of the page's SEO checks (a site product only).
    const seoChecks = isShop
      ? []
      : await db.productSeoCheck.findMany({
          where: { productId },
          orderBy: { createdAt: 'desc' },
          take: 20,
          select: {
            id: true,
            createdAt: true,
            url: true,
            finalUrl: true,
            status: true,
            loadMs: true,
            bytes: true,
            error: true,
            metrics: true,
          },
        });
    // The same article on the other channel (ADR-0021): a shop listing's site pages, a site
    // product's Etsy listings.
    const elsewhere = product.articles.length
      ? await db.shopProduct.findMany({
          where: {
            projectId,
            workspaceId: request.workspace.workspaceId,
            id: { not: productId },
            state: { not: 'removed' },
            articles: { hasSome: product.articles },
            account: { ...CATALOG_WHERE, platform: isShop ? 'WEBSITE' : 'ETSY' },
          },
          select: {
            id: true,
            title: true,
            url: true,
            imageUrl: true,
            state: true,
            price: true,
            currency: true,
            account: { select: { platform: true, username: true, displayName: true } },
          },
          orderBy: { title: 'asc' },
        })
      : [];
    const mine = [...product.skus].sort().join('\u0000');
    const twinSuggestions = sameSkus
      .filter(
        (c) =>
          [...c.skus].sort().join('\u0000') === mine &&
          (!product.twinGroupId || c.twinGroupId !== product.twinGroupId),
      )
      .map(({ twinGroupId: _group, ...c }) => c);
    const {
      externalId: _externalId,
      twinGroupId: _twinGroupId,
      articles: _articles,
      ...rest
    } = product;
    return {
      ...rest,
      sales: {
        units: sold.reduce((n, l) => n + l.quantity, 0),
        revenue: sold.reduce((n, l) => n + (l.price ?? 0) * l.quantity, 0),
        orders: sold.length,
        firstSale: sold.at(-1)?.order.orderedAt ?? null,
        lastSale: sold[0]?.order.orderedAt ?? null,
      },
      monthly: monthlySales(flat, 12, new Date().toISOString().slice(0, 10)),
      orders: sold.slice(0, 10).map((l) => ({
        id: l.id,
        orderedAt: l.order.orderedAt,
        quantity: l.quantity,
        price: l.price,
        currency: l.order.currency,
        country: l.order.country,
      })),
      posts,
      twins,
      twinSuggestions,
      twinCandidates: candidates,
      elsewhere,
      seoChecks,
    };
  }

  /**
   * Reads the product's page on the site as `adelie-bot` and records what it says to search engines
   * (ADR-0021). Only on a member's click, never on a schedule; only the connected site's own
   * pages; at most one check in 15 seconds per product.
   */
  @Post('products/:productId/seo-check')
  @WorkspaceRoles(...CONNECT_ROLES)
  async seoCheck(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('productId', ParseUUIDPipe) productId: string,
    @Req() request: { workspace: WorkspaceRequestContext },
    @Session() session: UserSession,
  ) {
    await this.visibleProject(request.workspace, projectId);
    const db = this.prisma.client;
    const product = await db.shopProduct.findFirst({
      where: {
        id: productId,
        projectId,
        workspaceId: request.workspace.workspaceId,
        account: { ...CATALOG_WHERE, platform: 'WEBSITE' },
      },
      select: { id: true, url: true, account: { select: { externalId: true } } },
    });
    if (!product) throw new NotFoundException();
    if (!product.url) throw new BadRequestException({ reason: 'noUrl' });
    const hostOf = (u: string) => {
      try {
        return new URL(u).hostname.replace(/^www\./, '').toLowerCase();
      } catch {
        return '';
      }
    };
    // Only pages of the site the member connected (its feed's host).
    if (!hostOf(product.url) || hostOf(product.url) !== hostOf(product.account.externalId)) {
      throw new BadRequestException({ reason: 'otherSite' });
    }
    const last = await db.productSeoCheck.findFirst({
      where: { productId },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });
    if (last && Date.now() - last.createdAt.getTime() < 15_000) {
      throw new HttpException({ reason: 'tooSoon' }, 429);
    }
    const base = {
      workspaceId: request.workspace.workspaceId,
      projectId,
      productId,
      userId: session.user.id,
      url: product.url,
    };
    const select = {
      id: true,
      createdAt: true,
      url: true,
      finalUrl: true,
      status: true,
      loadMs: true,
      bytes: true,
      error: true,
      metrics: true,
    } as const;
    try {
      const page = await fetchPage(product.url);
      const readable = page.status >= 200 && page.status < 300 && page.body;
      return await db.productSeoCheck.create({
        data: {
          ...base,
          finalUrl: page.finalUrl,
          status: page.status,
          loadMs: page.loadMs,
          bytes: page.bytes,
          metrics: readable
            ? (analyzePage(
                page.body,
                page.finalUrl,
                page.headers,
              ) as unknown as Prisma.InputJsonValue)
            : undefined,
        },
        select,
      });
    } catch (error) {
      if (!(error instanceof FeedFetchError)) throw error;
      // The page could not be read at all: that is a result worth keeping in the history.
      return db.productSeoCheck.create({ data: { ...base, error: error.kind }, select });
    }
  }

  /** A product of the project's shops, or 404. */
  private async shopProductOf(ctx: WorkspaceRequestContext, projectId: string, productId: string) {
    await this.visibleProject(ctx, projectId);
    const product = await this.prisma.client.shopProduct.findFirst({
      where: { id: productId, projectId, workspaceId: ctx.workspaceId, account: SHOP_WHERE },
      select: { id: true, twinGroupId: true },
    });
    if (!product) throw new NotFoundException();
    return product;
  }

  /** Marks another listing as the same product (twins): one group, merged when both have one. */
  @Put('products/:productId/twin')
  @WorkspaceRoles(...CONNECT_ROLES)
  async linkTwin(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('productId', ParseUUIDPipe) productId: string,
    @Body() body: { twinProductId?: unknown },
    @Req() request: { workspace: WorkspaceRequestContext },
  ) {
    const otherId = typeof body?.twinProductId === 'string' ? body.twinProductId : '';
    if (!UUID.test(otherId) || otherId === productId) throw new BadRequestException();
    const a = await this.shopProductOf(request.workspace, projectId, productId);
    const b = await this.shopProductOf(request.workspace, projectId, otherId);
    const group = a.twinGroupId ?? b.twinGroupId ?? randomUUID();
    const db = this.prisma.client;
    const joined = [a.twinGroupId, b.twinGroupId].filter((g): g is string => !!g && g !== group);
    await db.$transaction([
      ...(joined.length
        ? [
            db.shopProduct.updateMany({
              where: { projectId, twinGroupId: { in: joined } },
              data: { twinGroupId: group },
            }),
          ]
        : []),
      db.shopProduct.updateMany({
        where: { id: { in: [a.id, b.id] } },
        data: { twinGroupId: group },
      }),
    ]);
    return { ok: true };
  }

  /** Takes the listing out of its twin group; a group left with one listing is dissolved. */
  @Delete('products/:productId/twin')
  @WorkspaceRoles(...CONNECT_ROLES)
  async unlinkTwin(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('productId', ParseUUIDPipe) productId: string,
    @Req() request: { workspace: WorkspaceRequestContext },
  ) {
    const product = await this.shopProductOf(request.workspace, projectId, productId);
    if (!product.twinGroupId) return { ok: true };
    const db = this.prisma.client;
    await db.shopProduct.update({ where: { id: product.id }, data: { twinGroupId: null } });
    const left = await db.shopProduct.findMany({
      where: { projectId, twinGroupId: product.twinGroupId },
      select: { id: true },
    });
    if (left.length === 1) {
      await db.shopProduct.update({ where: { id: left[0]!.id }, data: { twinGroupId: null } });
    }
    return { ok: true };
  }

  /** "This is on purpose": the problem is no longer shown for the product. */
  @Put('products/:productId/issues/:code/ignore')
  @WorkspaceRoles(...CONNECT_ROLES)
  async ignoreIssue(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('productId', ParseUUIDPipe) productId: string,
    @Param('code') code: string,
    @Req() request: { workspace: WorkspaceRequestContext },
    @Session() session: UserSession,
  ) {
    if (!(ISSUE_CODES as readonly string[]).includes(code)) throw new BadRequestException();
    await this.shopProductOf(request.workspace, projectId, productId);
    await this.prisma.client.shopProductIssueIgnore.upsert({
      where: { productId_code: { productId, code } },
      create: {
        workspaceId: request.workspace.workspaceId,
        projectId,
        productId,
        code,
        userId: session.user.id,
      },
      update: {},
    });
    return { ok: true };
  }

  /** Brings an ignored problem back. */
  @Delete('products/:productId/issues/:code/ignore')
  @WorkspaceRoles(...CONNECT_ROLES)
  async unignoreIssue(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('productId', ParseUUIDPipe) productId: string,
    @Param('code') code: string,
    @Req() request: { workspace: WorkspaceRequestContext },
  ) {
    await this.shopProductOf(request.workspace, projectId, productId);
    await this.prisma.client.shopProductIssueIgnore.deleteMany({ where: { productId, code } });
    return { ok: true };
  }

  /**
   * A product as it is on the platform right now (never our copy: someone may have changed it in
   * Etsy since the last sync), whether it can be edited here, and its change history.
   */
  @Get('products/:productId/edit')
  async editForm(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('productId', ParseUUIDPipe) productId: string,
    @Req() request: { workspace: WorkspaceRequestContext },
  ) {
    const { product, reason } = await this.editableProduct(request.workspace, projectId, productId);
    const current =
      reason === null || reason === 'role' || reason === 'readOnly'
        ? await this.connector
            .withAccount(product.accountId, (adapter, ctx) =>
              adapter.getProductForEdit!(ctx, product.externalId),
            )
            .catch(() => null)
        : null;
    return {
      canEdit: reason === null && !!current,
      reason,
      // For the editor's header: what the product looks like and where it is in Etsy.
      product: {
        title: product.title,
        imageUrl: product.imageUrl,
        url: product.url,
        externalId: product.externalId,
      },
      current,
      history: await this.history(product.id),
    };
  }

  /**
   * Changes a product on the platform (ADR-0019: full access, a member's explicit action).
   * `expected` is what the person saw: if the platform has something else now, nothing is sent
   * (409) — no silent overwrite of a change made in Etsy meanwhile.
   */
  @Patch('products/:productId')
  @WorkspaceRoles(...CONNECT_ROLES)
  async update(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('productId', ParseUUIDPipe) productId: string,
    @Body() body: { changes?: unknown; expected?: unknown },
    @Req() request: { workspace: WorkspaceRequestContext },
    @Session() session: UserSession,
  ) {
    const { product, reason } = await this.editableProduct(request.workspace, projectId, productId);
    if (reason) throw new ForbiddenException({ reason });
    const changes = parseChanges(body?.changes);
    const expected = parseChanges(body?.expected);
    const errors = productChangeErrors(changes);
    if (errors.length) throw new BadRequestException({ errors });

    const db = this.prisma.client;
    return this.connector.withAccount(product.accountId, async (adapter, ctx) => {
      const live = await adapter.getProductForEdit!(ctx, product.externalId);
      // Requested values in the platform's comparable shape.
      const asked = (c: ProductChanges, k: keyof ProductChanges) =>
        k === 'variations'
          ? normalizeVariations(c.variations ?? []).map((v) => ({
              ...v,
              // A request that does not mention a SKU leaves it as it is on the platform.
              sku: v.sku ?? live.variations.find((l) => l.id === v.id)?.sku ?? '',
            }))
          : k === 'sku'
            ? c.sku?.trim()
            : k === 'skuOnProperty' || k === 'priceOnProperty' || k === 'quantityOnProperty'
              ? [...(c[k] ?? [])].sort()
              : c[k];
      const conflict = (Object.keys(changes) as (keyof ProductChanges)[]).some(
        (k) => k in expected && !same(valueOf(live, k), asked(expected, k)),
      );
      if (conflict) throw new ConflictException({ reason: 'changedOnPlatform', current: live });

      // Only what really differs from the platform is sent and recorded.
      const diff: Record<string, { from: unknown; to: unknown }> = {};
      for (const k of Object.keys(changes) as (keyof ProductChanges)[]) {
        const from = valueOf(live, k);
        const to = asked(changes, k);
        if (same(from, to)) continue;
        if (k === 'variations') {
          // Only the variations that changed go to the history.
          const before = from as VariationValue[];
          const after = to as VariationValue[];
          const changed = after.filter(
            (v) =>
              !same(
                v,
                before.find((b) => b.id === v.id),
              ),
          );
          diff[k] = {
            from: before.filter((b) => changed.some((c) => c.id === b.id)),
            to: changed,
          };
        } else {
          diff[k] = { from, to };
        }
      }
      if (!Object.keys(diff).length)
        return { current: live, history: await this.history(product.id) };
      const send = Object.fromEntries(
        Object.keys(diff).map((k) => [k, changes[k as keyof ProductChanges]]),
      ) as ProductChanges;

      const audit = {
        workspaceId: request.workspace.workspaceId,
        projectId,
        productId: product.id,
        userId: session.user.id,
        changes: diff as Prisma.InputJsonValue,
      };
      let after: ProductEditable;
      try {
        after = await adapter.updateProduct!(ctx, product.externalId, send);
      } catch (error) {
        const message = isAdapterError(error)
          ? `${error.message}${providerMessage(error.details.providerCode)}`
          : 'Unexpected error';
        await db.shopProductChange.create({ data: { ...audit, status: 'failed', error: message } });
        if (isAdapterError(error, 'NOT_AVAILABLE')) {
          throw new UnprocessableEntityException({ reason: 'variations' });
        }
        if (isAdapterError(error, 'INVALID')) {
          throw new UnprocessableEntityException({ reason: 'rejected', message });
        }
        throw error;
      }
      await db.shopProductChange.create({ data: { ...audit, status: 'applied' } });
      // Our copy follows at once (the next sync would do it too).
      const savedSkus = [
        ...new Set(
          (after.variations.length ? after.variations.map((v) => v.sku) : [after.sku])
            .map((x) => x.trim())
            .filter(Boolean),
        ),
      ];
      await db.shopProduct.update({
        where: { id: product.id },
        data: {
          title: after.title,
          tags: after.tags,
          skus: savedSkus,
          // What the product is matched to the other channels by follows its SKUs at once.
          articles: articlesOf(savedSkus),
          ...skuLayout(after),
          price: after.price?.amount ?? null,
          currency: after.price?.currency ?? undefined,
          quantity: after.quantity,
        },
      });
      return { current: after, history: await this.history(product.id) };
    });
  }

  private async visibleProject(ctx: WorkspaceRequestContext, projectId: string) {
    const project = await this.prisma.client.project.findFirst({
      where: { id: projectId, ...visibleProjectsWhere(ctx) },
      select: { id: true },
    });
    if (!project) throw new NotFoundException();
  }

  /** `from`/`to`: inclusive UTC days; both or neither (= all time). */
  private period(query: Record<string, string | undefined>) {
    const { from, to } = query;
    if ((from && !DAY.test(from)) || (to && !DAY.test(to))) {
      throw new BadRequestException('Dates must be YYYY-MM-DD');
    }
    if (!!from !== !!to) throw new BadRequestException('Period needs both from and to');
    return from && to
      ? { from, to, gte: asDate(from), lt: new Date(asDate(to).getTime() + DAY_MS) }
      : null;
  }

  private where(
    projectId: string,
    ctx: WorkspaceRequestContext,
    accountId: string | undefined,
    catalog = false,
  ): {
    projectId: string;
    workspaceId: string;
    accountId?: string;
    account: Prisma.SocialAccountWhereInput;
  } {
    return {
      projectId,
      workspaceId: ctx.workspaceId,
      ...(accountId ? { accountId } : {}),
      account: catalog ? CATALOG_WHERE : SHOP_WHERE,
    };
  }

  /** The project's shops, for the shop switch. */
  @Get('shops')
  async shops(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Query() query: Record<string, string | undefined>,
    @Req() request: { workspace: WorkspaceRequestContext },
  ) {
    await this.visibleProject(request.workspace, projectId);
    // `catalog=1`: sites too (the Products page); otherwise shops with orders. In the order the
    // member arranged the connections: the first one is the page's default channel.
    const project = await this.prisma.client.project.findUniqueOrThrow({
      where: { id: projectId },
      select: { accountOrder: true },
    });
    const shops = await this.prisma.client.socialAccount.findMany({
      where: {
        projectId,
        workspaceId: request.workspace.workspaceId,
        ...(query['catalog'] === '1' ? CATALOG_WHERE : SHOP_WHERE),
      },
      select: {
        id: true,
        createdAt: true,
        platform: true,
        username: true,
        displayName: true,
        avatarUrl: true,
        // Products on sale or kept (not the ones that left the shop or the feed).
        _count: { select: { products: { where: { state: { not: 'removed' } } } } },
      },
    });
    return orderAccounts(shops, project.accountOrder).map(
      ({ createdAt: _created, ...shop }) => shop,
    );
  }

  /**
   * Every product of the shops with what it sold in the period (all time without one): units and
   * revenue from order lines. Sorting and search happen in the browser — a shop has hundreds, not
   * millions, of products.
   */
  @Get('products')
  async products(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Query() query: Record<string, string | undefined>,
    @Req() request: { workspace: WorkspaceRequestContext },
  ) {
    await this.visibleProject(request.workspace, projectId);
    const period = this.period(query);
    const where = this.where(projectId, request.workspace, query['accountId'], true);
    const db = this.prisma.client;
    const [products, lines] = await Promise.all([
      db.shopProduct.findMany({
        where,
        orderBy: { listedAt: { sort: 'desc', nulls: 'last' } },
        take: 2000,
        select: {
          id: true,
          externalId: true,
          title: true,
          url: true,
          imageUrl: true,
          state: true,
          price: true,
          currency: true,
          quantity: true,
          views: true,
          favorers: true,
          tags: true,
          skus: true,
          articles: true,
          variationCount: true,
          skuBy: true,
          skuGroups: true,
          variationOptions: true,
          twinGroupId: true,
          listedAt: true,
          account: { select: { id: true, username: true, platform: true } },
        },
      }),
      db.shopOrderItem.findMany({
        where: {
          productId: { not: null },
          order: { ...where, ...(period ? { orderedAt: { gte: period.gte, lt: period.lt } } : {}) },
        },
        select: {
          productId: true,
          quantity: true,
          price: true,
          order: { select: { status: true } },
        },
      }),
    ]);
    // Posts that lead to each product: their own link or a link in their text (ADR-0018).
    const keysOf = (p: { account: { platform: string }; externalId: string; url: string | null }) =>
      productKeys({ platform: p.account.platform, externalId: p.externalId, url: p.url });
    const allKeys = [...new Set(products.flatMap(keysOf))];
    const links = allKeys.length
      ? await db.socialPostLink.findMany({
          where: {
            projectId,
            workspaceId: request.workspace.workspaceId,
            key: { in: allKeys },
            post: { account: { hiddenAt: null, connection: { status: { not: 'REVOKED' } } } },
          },
          select: { key: true, postId: true },
        })
      : [];
    const postsByKey = new Map<string, Set<string>>();
    for (const l of links)
      postsByKey.set(l.key, (postsByKey.get(l.key) ?? new Set()).add(l.postId));
    const postsOf = (p: Parameters<typeof keysOf>[0]) =>
      new Set(keysOf(p).flatMap((k) => [...(postsByKey.get(k) ?? [])])).size;
    // What each channel (the shop, the site) has, project-wide — not only the shown shop's.
    const channelRows = await db.shopProduct.findMany({
      where: {
        projectId,
        workspaceId: request.workspace.workspaceId,
        state: { not: 'removed' },
        account: CATALOG_WHERE,
      },
      select: {
        id: true,
        articles: true,
        title: true,
        url: true,
        imageUrl: true,
        state: true,
        price: true,
        currency: true,
        account: { select: { id: true, platform: true, username: true, displayName: true } },
      },
    });
    // The same article on the other channels (ADR-0021), for the row's expansion and the
    // "on / not on" filters: article → the products that have it.
    const byArticle = new Map<string, typeof channelRows>();
    for (const r of channelRows) {
      for (const a of r.articles) byArticle.set(a, [...(byArticle.get(a) ?? []), r]);
    }
    const elsewhereOf = (p: { id: string; account: { id: string }; articles: string[] }) => {
      const seen = new Map<string, (typeof channelRows)[number]>();
      for (const a of p.articles) {
        for (const r of byArticle.get(a) ?? []) {
          if (r.account.id !== p.account.id) seen.set(r.id, r);
        }
      }
      return [...seen.values()].slice(0, 40).map(({ articles: _a, ...r }) => r);
    };
    const articlesOn = (platform: string) => {
      const rows = channelRows.filter((r) => r.account.platform === platform);
      return rows.length ? new Set(rows.flatMap((r) => r.articles)) : null;
    };
    const issues = productIssues(
      products.map((p) => ({ ...p, platform: p.account.platform, posts: postsOf(p) })),
      new Date(),
      { site: articlesOn('WEBSITE'), etsy: articlesOn('ETSY') },
    );
    // Problems the user marked "on purpose" are set apart (and can be brought back).
    const ignores = await db.shopProductIssueIgnore.findMany({
      where: {
        projectId,
        workspaceId: request.workspace.workspaceId,
        productId: { in: products.map((p) => p.id) },
      },
      select: { productId: true, code: true },
    });
    const ignoredCodes = new Map<string, Set<string>>();
    for (const i of ignores) {
      ignoredCodes.set(i.productId, (ignoredCodes.get(i.productId) ?? new Set()).add(i.code));
    }
    const issuesOf = (id: string, ignored: boolean): Issue[] =>
      (issues.get(id) ?? []).filter((i) => !!ignoredCodes.get(id)?.has(i.code) === ignored);
    const sold = new Map<string, { units: number; revenue: number }>();
    for (const l of lines) {
      if (!countsAsSale(l.order.status)) continue;
      const s = sold.get(l.productId!) ?? { units: 0, revenue: 0 };
      s.units += l.quantity;
      s.revenue += (l.price ?? 0) * l.quantity;
      sold.set(l.productId!, s);
    }
    return {
      period: period ? { from: period.from, to: period.to } : null,
      items: products.map(
        ({
          externalId,
          tags: _tags,
          variationCount: _variations,
          skuGroups: _groups,
          variationOptions: _options,
          articles,
          ...p
        }) => ({
          ...p,
          // A site's sales are not known (no orders come from a feed): null, never 0 by assumption.
          sold: p.account.platform === 'WEBSITE' ? null : (sold.get(p.id)?.units ?? 0),
          revenue: p.account.platform === 'WEBSITE' ? null : (sold.get(p.id)?.revenue ?? 0),
          posts: postsOf({ ...p, externalId }),
          issues: issuesOf(p.id, false),
          ignored: issuesOf(p.id, true),
          elsewhere: elsewhereOf({ ...p, articles }),
        }),
      ),
    };
  }

  /**
   * Orders of a period: totals per currency, revenue per day, countries, and a page of the orders
   * themselves (newest first) with their lines.
   */
  @Get('orders')
  async orders(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Query() query: Record<string, string | undefined>,
    @Req() request: { workspace: WorkspaceRequestContext },
  ) {
    await this.visibleProject(request.workspace, projectId);
    const period = this.period(query);
    const page = Math.max(0, Number(query['page'] ?? 0) || 0);
    const sort = query['sort'] ?? 'date';
    if (!['date', 'amount', 'units'].includes(sort)) throw new BadRequestException('Unknown sort');
    const dir = query['dir'] === 'asc' ? 1 : -1;
    for (const k of ['paid', 'shipped'] as const) {
      if (query[k] && !['yes', 'no'].includes(query[k]!)) throw new BadRequestException(`Bad ${k}`);
    }
    // The period and the shop: the base for the filter options and the ledger.
    const base: Prisma.ShopOrderWhereInput = {
      ...this.where(projectId, request.workspace, query['accountId']),
      ...(period ? { orderedAt: { gte: period.gte, lt: period.lt } } : {}),
    };
    const q = query['q']?.trim();
    const where: Prisma.ShopOrderWhereInput = {
      ...base,
      ...(query['status'] ? { status: query['status'] } : {}),
      ...(query['paid'] ? { isPaid: query['paid'] === 'yes' } : {}),
      ...(query['shipped'] ? { isShipped: query['shipped'] === 'yes' } : {}),
      ...(query['country'] !== undefined && query['country'] !== ''
        ? { country: query['country'] === '-' ? null : query['country'] }
        : {}),
      ...(q
        ? {
            OR: [
              { externalId: q.replace(/^#/, '') },
              { items: { some: { title: { contains: q, mode: 'insensitive' } } } },
            ],
          }
        : {}),
    };
    const db = this.prisma.client;
    const [ledger, all, facets] = await Promise.all([
      // What stays with the shop: the payment account's movements in the period.
      db.shopLedgerEntry.groupBy({
        by: ['currency', 'category'],
        where: {
          ...this.where(projectId, request.workspace, query['accountId']),
          ...(period ? { occurredAt: { gte: period.gte, lt: period.lt } } : {}),
        },
        _sum: { amount: true },
      }),
      // Every matching order: a shop has hundreds or thousands — sorted and paged in memory.
      db.shopOrder.findMany({
        where,
        select: {
          id: true,
          externalId: true,
          orderedAt: true,
          status: true,
          isPaid: true,
          isShipped: true,
          currency: true,
          total: true,
          tax: true,
          shipping: true,
          discount: true,
          country: true,
          account: { select: { id: true, username: true, platform: true } },
          items: {
            select: {
              id: true,
              title: true,
              quantity: true,
              price: true,
              product: { select: { id: true, imageUrl: true, url: true, title: true } },
            },
          },
        },
      }),
      // Filter options for the period (not narrowed by the filters themselves).
      db.shopOrder.findMany({
        where: base,
        select: {
          status: true,
          country: true,
          isPaid: true,
          currency: true,
          total: true,
          tax: true,
        },
      }),
    ]);

    const units = (o: { items: { quantity: number }[] }) =>
      o.items.reduce((n, i) => n + i.quantity, 0);
    // Canceled and fully refunded orders are listed, but they are not sales.
    const sales = all.filter((o) => countsAsSale(o.status));

    // Totals per currency (shops may sell in different ones; never summed across currencies).
    const totals = new Map<
      string,
      { currency: string; orders: number; units: number; revenue: number; tax: number }
    >();
    const countries = new Map<string, { country: string; orders: number }>();
    for (const o of sales) {
      const t = totals.get(o.currency) ?? {
        currency: o.currency,
        orders: 0,
        units: 0,
        revenue: 0,
        tax: 0,
      };
      t.orders += 1;
      t.units += units(o);
      t.revenue += netRevenue(o) ?? 0;
      t.tax += o.tax ?? 0;
      totals.set(o.currency, t);
      const c = o.country ?? '';
      countries.set(c, { country: c, orders: (countries.get(c)?.orders ?? 0) + 1 });
    }
    const main = [...totals.values()].sort((a, b) => b.orders - a.orders)[0]?.currency ?? null;
    const first = sales.reduce<Date | null>(
      (min, o) => (!min || o.orderedAt < min ? o.orderedAt : min),
      null,
    );

    const key = (o: (typeof all)[number]) =>
      sort === 'amount'
        ? (netRevenue(o) ?? -1)
        : sort === 'units'
          ? units(o)
          : o.orderedAt.getTime();
    const ordered = [...all].sort(
      (a, b) => dir * (key(a) - key(b)) || b.orderedAt.getTime() - a.orderedAt.getTime(),
    );
    const rows = ordered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
    const distinct = (values: (string | null)[]) => [...new Set(values.map((v) => v ?? ''))].sort();

    return {
      period: period ? { from: period.from, to: period.to } : null,
      total: all.length,
      page,
      pageSize: PAGE_SIZE,
      totals: [...totals.values()].sort((a, b) => b.orders - a.orders),
      // The chart uses the main currency; days run over the period (or from the first order).
      series:
        main && (period || first)
          ? ordersByDay(
              sales.filter((o) => o.currency === main),
              period?.from ?? first!.toISOString().slice(0, 10),
              period?.to ?? new Date().toISOString().slice(0, 10),
            )
          : [],
      seriesCurrency: main,
      countries: [...countries.values()].sort((a, b) => b.orders - a.orders),
      facets: {
        statuses: distinct(facets.map((f) => f.status)).filter(Boolean),
        countries: distinct(facets.map((f) => f.country)),
      },
      money: moneyFlow(
        ledger.map((g) => ({
          currency: g.currency,
          category: g.category,
          amount: g._sum.amount ?? 0,
        })),
        // Paid orders of the period (refunds of canceled ones come from the ledger).
        facets.reduce((m, o) => {
          if (o.isPaid) m.set(o.currency, (m.get(o.currency) ?? 0) + (netRevenue(o) ?? 0));
          return m;
        }, new Map<string, number>()),
      ),
      items: rows.map(({ externalId, ...o }) => ({
        ...o,
        number: externalId,
        revenue: netRevenue(o),
        units: units(o),
      })),
    };
  }
}

type VariationValue = {
  id: string;
  price: number | null;
  quantity: number | null;
  enabled: boolean;
  /** null = not given in a request. */
  sku: string | null;
};

/** Variations in a comparable shape: by id, price in minor units. */
function normalizeVariations(
  list: {
    id: string;
    price?: number | null | { amount: number };
    quantity?: number | null;
    enabled?: boolean;
    sku?: string | null;
  }[],
): VariationValue[] {
  return list
    .map((v) => ({
      id: v.id,
      price: typeof v.price === 'object' && v.price !== null ? v.price.amount : (v.price ?? null),
      quantity: v.quantity ?? null,
      enabled: v.enabled ?? true,
      sku: typeof v.sku === 'string' ? v.sku.trim() : null,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

/** The editable value of a field as the platform has it (price in minor units). */
function valueOf(p: ProductEditable, key: keyof ProductChanges): unknown {
  if (key === 'price') return p.price?.amount ?? null;
  if (key === 'variations') return normalizeVariations(p.variations);
  if (key === 'skuOnProperty' || key === 'priceOnProperty' || key === 'quantityOnProperty') {
    return [...p[key]].sort();
  }
  return p[key];
}

/** Our copy of how the product's SKUs are organised, after a save. */
function skuLayout(p: ProductEditable) {
  const { by, groups } = skuStructure(p.variations, p.skuOnProperty);
  return {
    variationCount: p.variations.length || 1,
    skuBy: by,
    skuGroups: groups,
    variationOptions: p.skuProperties.map((o) => o.name),
  };
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Etsy's own words, when it rejected a change (e.g. a word not allowed in a title). */
function providerMessage(code: unknown): string {
  const text = (code as { error?: unknown } | null)?.error;
  return typeof text === 'string' ? `: ${text.slice(0, 300)}` : '';
}

/** Keeps only well-typed fields of a change request. */
function parseChanges(raw: unknown): ProductChanges {
  const r = (raw ?? {}) as Record<string, unknown>;
  const out: ProductChanges = {};
  if (typeof r['title'] === 'string') out.title = r['title'];
  if (typeof r['description'] === 'string') out.description = r['description'];
  if (Array.isArray(r['tags']) && r['tags'].every((t) => typeof t === 'string')) {
    out.tags = (r['tags'] as string[]).map((t) => t.trim()).filter(Boolean);
  }
  if (typeof r['price'] === 'number') out.price = r['price'];
  if (typeof r['quantity'] === 'number') out.quantity = r['quantity'];
  if (typeof r['sku'] === 'string') out.sku = r['sku'].trim();
  for (const key of ['skuOnProperty', 'priceOnProperty', 'quantityOnProperty'] as const) {
    const value = r[key];
    if (Array.isArray(value) && value.every((x) => typeof x === 'string')) out[key] = value;
  }
  if (Array.isArray(r['variations'])) {
    const list = (r['variations'] as Record<string, unknown>[]).filter(
      (v) => v && typeof v['id'] === 'string',
    );
    out.variations = normalizeVariations(
      list.map((v) => ({
        id: v['id'] as string,
        price: typeof v['price'] === 'number' ? v['price'] : null,
        quantity: typeof v['quantity'] === 'number' ? v['quantity'] : null,
        enabled: v['enabled'] !== false,
        sku: typeof v['sku'] === 'string' ? v['sku'] : null,
      })),
    ).map((v) => ({
      id: v.id,
      ...(v.price !== null ? { price: v.price } : {}),
      ...(v.quantity !== null ? { quantity: v.quantity } : {}),
      ...(v.sku !== null ? { sku: v.sku } : {}),
      enabled: v.enabled,
    }));
  }
  return out;
}
