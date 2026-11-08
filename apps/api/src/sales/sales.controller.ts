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
import { visibleProjectsWhere } from '../workspaces/project-visibility.js';
import {
  WorkspaceAccessGuard,
  type WorkspaceRequestContext,
} from '../workspaces/workspace-access.guard.js';
import { netRevenue, ordersByDay } from './sales.js';

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;
const asDate = (d: string) => new Date(`${d}T00:00:00Z`);
const PAGE_SIZE = 50;

/** Shops of the project that are shown: not hidden, not disconnected (their history is kept). */
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
  constructor(private readonly prisma: PrismaService) {}

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
  ): { projectId: string; workspaceId: string; accountId?: string; account: typeof SHOP_WHERE } {
    return {
      projectId,
      workspaceId: ctx.workspaceId,
      ...(accountId ? { accountId } : {}),
      account: SHOP_WHERE,
    };
  }

  /** The project's shops, for the shop switch. */
  @Get('shops')
  async shops(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Req() request: { workspace: WorkspaceRequestContext },
  ) {
    await this.visibleProject(request.workspace, projectId);
    return this.prisma.client.socialAccount.findMany({
      where: { projectId, workspaceId: request.workspace.workspaceId, ...SHOP_WHERE },
      orderBy: { createdAt: 'asc' },
      select: { id: true, platform: true, username: true, displayName: true, avatarUrl: true },
    });
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
    const where = this.where(projectId, request.workspace, query['accountId']);
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
          listedAt: true,
          account: { select: { id: true, username: true, platform: true } },
        },
      }),
      db.shopOrderItem.findMany({
        where: {
          productId: { not: null },
          order: { ...where, ...(period ? { orderedAt: { gte: period.gte, lt: period.lt } } : {}) },
        },
        select: { productId: true, quantity: true, price: true },
      }),
    ]);
    // Posts that lead to each product (pin links, ADR-0018).
    const keyOf = (p: { account: { platform: string }; id: string; externalId: string }) =>
      `${p.account.platform.toLowerCase()}:${p.externalId}`;
    const leading = products.length
      ? await db.socialPost.groupBy({
          by: ['linkKey'],
          where: {
            projectId,
            workspaceId: request.workspace.workspaceId,
            linkKey: { in: products.map(keyOf) },
            account: { hiddenAt: null, connection: { status: { not: 'REVOKED' } } },
          },
          _count: { _all: true },
        })
      : [];
    const posts = new Map(leading.map((g) => [g.linkKey, g._count._all]));
    const sold = new Map<string, { units: number; revenue: number }>();
    for (const l of lines) {
      const s = sold.get(l.productId!) ?? { units: 0, revenue: 0 };
      s.units += l.quantity;
      s.revenue += (l.price ?? 0) * l.quantity;
      sold.set(l.productId!, s);
    }
    return {
      period: period ? { from: period.from, to: period.to } : null,
      items: products.map(({ externalId, ...p }) => ({
        ...p,
        sold: sold.get(p.id)?.units ?? 0,
        revenue: sold.get(p.id)?.revenue ?? 0,
        posts: posts.get(keyOf({ ...p, externalId })) ?? 0,
      })),
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
    const where: Prisma.ShopOrderWhereInput = {
      ...this.where(projectId, request.workspace, query['accountId']),
      ...(period ? { orderedAt: { gte: period.gte, lt: period.lt } } : {}),
    };
    const db = this.prisma.client;
    const [all, rows] = await Promise.all([
      db.shopOrder.findMany({
        where,
        select: {
          orderedAt: true,
          currency: true,
          total: true,
          tax: true,
          shipping: true,
          country: true,
          items: { select: { quantity: true } },
        },
      }),
      db.shopOrder.findMany({
        where,
        orderBy: [{ orderedAt: 'desc' }, { id: 'asc' }],
        skip: page * PAGE_SIZE,
        take: PAGE_SIZE,
        select: {
          id: true,
          externalId: true,
          orderedAt: true,
          status: true,
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
    ]);

    // Totals per currency (shops may sell in different ones; never summed across currencies).
    const totals = new Map<
      string,
      { currency: string; orders: number; units: number; revenue: number; tax: number }
    >();
    const countries = new Map<string, { country: string; orders: number }>();
    for (const o of all) {
      const t = totals.get(o.currency) ?? {
        currency: o.currency,
        orders: 0,
        units: 0,
        revenue: 0,
        tax: 0,
      };
      t.orders += 1;
      t.units += o.items.reduce((n, i) => n + i.quantity, 0);
      t.revenue += netRevenue(o) ?? 0;
      t.tax += o.tax ?? 0;
      totals.set(o.currency, t);
      const c = o.country ?? '';
      countries.set(c, { country: c, orders: (countries.get(c)?.orders ?? 0) + 1 });
    }
    const main = [...totals.values()].sort((a, b) => b.orders - a.orders)[0]?.currency ?? null;
    const first = all.reduce<Date | null>(
      (min, o) => (!min || o.orderedAt < min ? o.orderedAt : min),
      null,
    );

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
              all.filter((o) => o.currency === main),
              period?.from ?? first!.toISOString().slice(0, 10),
              period?.to ?? new Date().toISOString().slice(0, 10),
            )
          : [],
      seriesCurrency: main,
      countries: [...countries.values()].sort((a, b) => b.orders - a.orders),
      items: rows.map((o) => ({ ...o, revenue: netRevenue(o) })),
    };
  }
}
