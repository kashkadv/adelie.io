import { randomBytes } from 'node:crypto';
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
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Prisma } from '@adelie/db';
import { hashServerKey, newServerKey } from './server-purchase.js';
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
/** What the sources report can be grouped by: a fixed list, so no column name comes from outside. */
const GROUPS = {
  channel: Prisma.raw('"channel"'),
  source: Prisma.raw('"source"'),
  medium: Prisma.raw('"medium"'),
  source_medium: Prisma.raw(`concat("source", ' / ', "medium")`),
  campaign: Prisma.raw('"campaign"'),
  content: Prisma.raw('"content"'),
  term: Prisma.raw('"term"'),
} as const;

/** The steps of the checkout page, in the order a buyer meets them. */
export const CHECKOUT_STEPS = [
  'BeginCheckout',
  'CheckoutFieldBlur',
  'DeliveryMethodSelected',
  'DeliveryCitySelected',
  'DeliveryWarehouseSelected',
  'PaymentClicked',
  'Purchase',
] as const;

export const FUNNEL = [
  'ViewCategory',
  'ProductView',
  'AddToCart',
  'BeginCheckout',
  'Purchase',
] as const;

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
      select: { id: true, publicId: true, accountId: true },
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
        trackedSite: {
          select: {
            id: true,
            publicId: true,
            allowedHosts: true,
            consentMode: true,
            serverKeyHint: true,
            createdAt: true,
          },
        },
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
            consentMode: trackedSite.consentMode,
            serverKeyHint: trackedSite.serverKeyHint,
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

  /** Sets the site's consent mode. It reaches the site with the script, within minutes. */
  @Patch(':accountId')
  @WorkspaceRoles(...CONNECT_ROLES)
  async setMode(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('accountId', ParseUUIDPipe) accountId: string,
    @Body() body: { consentMode?: unknown },
    @Req() request: { workspace: WorkspaceRequestContext },
  ) {
    const mode = body?.consentMode;
    if (mode !== 'anonymous' && mode !== 'granted') {
      throw new BadRequestException({ errors: { consentMode: 'invalid' } });
    }
    const site = await this.siteOf(request.workspace, projectId, accountId);
    await this.prisma.client.trackedSite.update({
      where: { id: site.id },
      data: { consentMode: mode },
    });
    return { consentMode: mode };
  }

  /**
   * Makes a new server key for the site (the old one stops working). The key is in the answer
   * once: only its hash is stored.
   */
  @Post(':accountId/server-key')
  @WorkspaceRoles(...CONNECT_ROLES)
  async serverKey(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('accountId', ParseUUIDPipe) accountId: string,
    @Req() request: { workspace: WorkspaceRequestContext },
  ) {
    const site = await this.siteOf(request.workspace, projectId, accountId);
    const key = newServerKey();
    await this.prisma.client.trackedSite.update({
      where: { id: site.id },
      data: { serverKeyHash: hashServerKey(key), serverKeyHint: key.slice(-4) },
    });
    return { key, hint: key.slice(-4) };
  }

  /** The latest events, newest first. Bots are left out. */
  @Get(':accountId/events')
  async events(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('accountId', ParseUUIDPipe) accountId: string,
    @Query('limit') limit: string | undefined,
    @Query('page') page: string | undefined,
    @Req() request: { workspace: WorkspaceRequestContext },
  ) {
    const site = await this.siteOf(request.workspace, projectId, accountId);
    const take = Math.min(Math.max(Number(limit) || 25, 1), 200);
    const where = { siteId: site.id, isBot: false };
    const [total, rows] = await Promise.all([
      this.prisma.client.websiteEvent.count({ where }),
      this.prisma.client.websiteEvent.findMany({
        where,
        orderBy: { occurredAt: 'desc' },
        take,
        skip: (Math.max(Number(page) || 1, 1) - 1) * take,
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
      }),
    ]);
    // The visitor as a short label (never the id itself): enough to tell people apart in a list.
    return {
      total,
      rows: rows.map(({ visitorId, dailyId, ...e }) => ({
        ...e,
        visitor: (visitorId ?? dailyId)?.slice(0, 6) ?? null,
      })),
    };
  }

  /**
   * Where the visitors came from, in detail: by channel, source, medium, campaign, content or
   * term (optionally within one channel). Visits count arrivals (also of those who did not agree);
   * the steps after that count the visitors who agreed, since only they are followed.
   */
  @Get(':accountId/sources')
  async sources(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('accountId', ParseUUIDPipe) accountId: string,
    @Query('days') days: string | undefined,
    @Query('by') by: string | undefined,
    @Query('channel') channel: string | undefined,
    @Req() request: { workspace: WorkspaceRequestContext },
  ) {
    const site = await this.siteOf(request.workspace, projectId, accountId);
    const n = [7, 30, 90].includes(Number(days)) ? Number(days) : 7;
    const since = new Date(Date.now() - n * 86_400_000);
    const group = GROUPS[(by ?? 'channel') as keyof typeof GROUPS] ?? GROUPS.channel;
    const within = channel ? Prisma.sql`AND "channel" = ${channel}` : Prisma.empty;
    const rows = await this.prisma.client.$queryRaw<
      {
        label: string;
        visits: number;
        visitors: number;
        productViews: number;
        addToCart: number;
        checkouts: number;
        purchases: number;
        revenue: number | null;
      }[]
    >`
      SELECT coalesce(nullif(nullif(${group}, ''), ' / '), '(none)') AS label,
        (count(DISTINCT "sessionId") FILTER (WHERE consent AND name = 'PageView')
          + count(*) FILTER (WHERE NOT consent AND name = 'PageView'))::int AS visits,
        count(DISTINCT "visitorId") FILTER (WHERE name = 'PageView')::int AS visitors,
        count(DISTINCT "visitorId") FILTER (WHERE name = 'ProductView')::int AS "productViews",
        count(DISTINCT "visitorId") FILTER (WHERE name = 'AddToCart')::int AS "addToCart",
        count(DISTINCT "visitorId") FILTER (WHERE name = 'BeginCheckout')::int AS checkouts,
        count(*) FILTER (WHERE name = 'Purchase')::int AS purchases,
        sum(CASE WHEN name = 'Purchase' AND jsonb_typeof(properties->'value') = 'number'
                 THEN (properties->>'value')::numeric END)::float8 AS revenue
      FROM website_event
      WHERE "siteId" = ${site.id}::uuid AND "occurredAt" >= ${since} AND NOT "isBot"
        AND "channel" IS NOT NULL ${within}
      GROUP BY 1 ORDER BY visits DESC, purchases DESC LIMIT 200`;
    const currency = await this.prisma.client.$queryRaw<{ currency: string | null }[]>`
      SELECT properties->>'currency' AS currency FROM website_event
      WHERE "siteId" = ${site.id}::uuid AND name = 'Purchase' AND properties->>'currency' IS NOT NULL
      ORDER BY "occurredAt" DESC LIMIT 1`;
    return { days: n, currency: currency[0]?.currency ?? null, rows };
  }

  /**
   * Where buyers stop on the checkout page: how many reached each step, which fields were filled
   * or left empty, which fields failed validation, and what they chose. Visitors who agreed only
   * (a person is followed across steps only then). Never what was typed: only field names.
   */
  @Get(':accountId/checkout')
  async checkout(
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
    const base = Prisma.sql`"siteId" = ${sid}::uuid AND "occurredAt" >= ${since} AND NOT "isBot" AND "visitorId" IS NOT NULL`;
    const [steps, fields, failures, delivery, payment] = await Promise.all([
      db.$queryRaw<{ name: string; visitors: number }[]>`
        SELECT name, count(DISTINCT coalesce("visitorId", "eventId"))::int AS visitors
        FROM website_event
        WHERE "siteId" = ${sid}::uuid AND "occurredAt" >= ${since} AND NOT "isBot"
          AND ("visitorId" IS NOT NULL OR name = 'Purchase')
          AND name IN (${Prisma.join([...CHECKOUT_STEPS])})
        GROUP BY name`,
      db.$queryRaw<{ field: string; visitors: number; filled: number }[]>`
        SELECT properties->>'field' AS field,
               count(DISTINCT "visitorId")::int AS visitors,
               count(DISTINCT "visitorId") FILTER (WHERE properties->>'filled' = 'true')::int AS filled
        FROM website_event
        WHERE ${base} AND name = 'CheckoutFieldBlur' AND properties->>'field' IS NOT NULL
        GROUP BY 1 ORDER BY visitors DESC LIMIT 30`,
      db.$queryRaw<{ field: string; visitors: number }[]>`
        SELECT f AS field, count(DISTINCT "visitorId")::int AS visitors
        FROM website_event, unnest(string_to_array(properties->>'fields', ',')) AS f
        WHERE ${base} AND name = 'CheckoutValidationFailed' AND f <> ''
        GROUP BY 1 ORDER BY visitors DESC LIMIT 30`,
      db.$queryRaw<{ value: string; visitors: number }[]>`
        SELECT properties->>'method' AS value, count(DISTINCT "visitorId")::int AS visitors
        FROM website_event
        WHERE ${base} AND name = 'DeliveryMethodSelected' AND properties->>'method' IS NOT NULL
        GROUP BY 1 ORDER BY visitors DESC LIMIT 20`,
      db.$queryRaw<{ value: string; visitors: number }[]>`
        SELECT properties->>'payment_method' AS value, count(DISTINCT "visitorId")::int AS visitors
        FROM website_event
        WHERE ${base} AND name = 'PaymentClicked' AND properties->>'payment_method' IS NOT NULL
        GROUP BY 1 ORDER BY visitors DESC LIMIT 20`,
    ]);
    const by = new Map(steps.map((x) => [x.name, x.visitors]));
    return {
      days: n,
      steps: CHECKOUT_STEPS.map((name) => ({ name, visitors: by.get(name) ?? 0 })),
      fields,
      failures,
      delivery,
      payment,
    };
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
      db.$queryRaw<{ name: string; events: number; visitors: number }[]>`
        SELECT name, count(*)::int AS events,
               count(DISTINCT coalesce("visitorId", "dailyId", "eventId"))::int AS visitors FROM website_event
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
        SELECT name, count(DISTINCT coalesce("visitorId", "eventId"))::int AS visitors
        FROM website_event
        WHERE "siteId" = ${sid}::uuid AND "occurredAt" >= ${since} AND NOT "isBot"
          AND ("visitorId" IS NOT NULL OR name = 'Purchase')
          AND name IN (${Prisma.join([...FUNNEL])})
        GROUP BY name`,
      // A visit is a session of someone who agreed, or an arrival of someone who did not (their
      // page view of the landing is the only one that says where they came from): comparable.
      db.$queryRaw<{ channel: string; visits: number }[]>`
        SELECT channel,
               (count(DISTINCT "sessionId") FILTER (WHERE consent)
                + count(*) FILTER (WHERE NOT consent))::int AS visits
        FROM website_event
        WHERE "siteId" = ${sid}::uuid AND "occurredAt" >= ${since} AND NOT "isBot"
          AND name = 'PageView' AND channel IS NOT NULL
        GROUP BY channel ORDER BY visits DESC LIMIT 10`,
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
    // The viewed products by name, from the site's own catalogue (the article is the feed's g:id).
    const articles = products.map((p) => p.item);
    const catalogue = articles.length
      ? await db.shopProduct.findMany({
          where: {
            accountId: site.accountId,
            OR: [{ externalId: { in: articles } }, { articles: { hasSome: articles } }],
          },
          select: { externalId: true, articles: true, title: true, url: true },
        })
      : [];
    const named = products.map((p) => {
      const found = catalogue.find((c) => c.externalId === p.item || c.articles.includes(p.item));
      return { ...p, title: found?.title ?? null, url: found?.url ?? null };
    });
    const byName = new Map(funnel.map((f) => [f.name, f.visitors]));
    return {
      days: n,
      counts,
      daily,
      funnel: FUNNEL.map((name) => ({ name, visitors: byName.get(name) ?? 0 })),
      channels,
      products: named,
      consent: consent[0] ?? { consenting: 0, anonymous: 0 },
    };
  }
}
