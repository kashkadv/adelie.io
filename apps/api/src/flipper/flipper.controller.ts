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
import { periodOf } from './period.js';
import { hashServerKey, newServerKey } from './server-purchase.js';
import {
  SITE_KINDS,
  goalSql,
  isSiteKind,
  parseSettings,
  settingsOf,
  stepSql,
  type Goal,
} from './site-kinds.js';
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
      select: { id: true, timezone: true },
    });
    if (!project) throw new NotFoundException();
    return project;
  }

  private async siteOf(ctx: WorkspaceRequestContext, projectId: string, accountId: string) {
    const project = await this.visibleProject(ctx, projectId);
    const site = await this.prisma.client.trackedSite.findFirst({
      where: { accountId, projectId, workspaceId: ctx.workspaceId },
      select: { id: true, publicId: true, accountId: true, kind: true, goals: true, funnel: true },
    });
    if (!site) throw new NotFoundException();
    return { ...site, settings: settingsOf(site), timeZone: project.timezone };
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
            kind: true,
            goals: true,
            funnel: true,
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
            // What it measures (ADR-0026), with the kind's defaults filled in.
            ...settingsOf(trackedSite),
            customFunnel: trackedSite.funnel !== null,
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
    @Body() body: { kind?: unknown } | undefined,
    @Req() request: { workspace: WorkspaceRequestContext },
  ) {
    const kind = body?.kind === undefined ? 'store' : body.kind;
    if (!isSiteKind(kind)) throw new BadRequestException({ errors: { kind: 'invalid' } });
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
        // The kind's starting goals; the funnel follows the kind until it is changed.
        kind,
        goals: SITE_KINDS[kind].goals as unknown as Prisma.InputJsonValue,
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
   * What the site measures (ADR-0026): its kind, goals and funnel. `funnel: null` follows the
   * kind's funnel. Nothing about stored events changes: the cabinet re-counts with the new rules.
   */
  @Patch(':accountId/settings')
  @WorkspaceRoles(...CONNECT_ROLES)
  async setSettings(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('accountId', ParseUUIDPipe) accountId: string,
    @Body() body: { kind?: unknown; goals?: unknown; funnel?: unknown },
    @Req() request: { workspace: WorkspaceRequestContext },
  ) {
    const site = await this.siteOf(request.workspace, projectId, accountId);
    const kind = body?.kind === undefined ? site.settings.kind : body.kind;
    if (!isSiteKind(kind)) throw new BadRequestException({ errors: { kind: 'invalid' } });
    const parsed = parseSettings(
      body?.goals === undefined ? site.settings.goals : body.goals,
      body?.funnel === undefined ? (site.funnel ?? null) : body.funnel,
    );
    if (!parsed.ok) throw new BadRequestException({ errors: { [parsed.error]: 'invalid' } });
    const saved = await this.prisma.client.trackedSite.update({
      where: { id: site.id },
      data: {
        kind,
        goals: parsed.goals as unknown as Prisma.InputJsonValue,
        funnel: parsed.funnel === null ? Prisma.DbNull : (parsed.funnel as Prisma.InputJsonValue),
      },
      select: { kind: true, goals: true, funnel: true },
    });
    return { ...settingsOf(saved), customFunnel: saved.funnel !== null };
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
    @Query('days') days: string | undefined,
    @Req() request: { workspace: WorkspaceRequestContext },
  ) {
    const site = await this.siteOf(request.workspace, projectId, accountId);
    const take = Math.min(Math.max(Number(limit) || 25, 1), 200);
    const where = {
      siteId: site.id,
      isBot: false,
      ...(days ? { occurredAt: { gte: periodOf(days, site.timeZone).since } } : {}),
    };
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
    const { n, since } = periodOf(days, site.timeZone);
    const group = GROUPS[(by ?? 'channel') as keyof typeof GROUPS] ?? GROUPS.channel;
    const within = channel ? Prisma.sql`AND "channel" = ${channel}` : Prisma.empty;
    const { goals, funnel } = site.settings;
    // The funnel's event steps after the first (visitors), and every goal (conversions and worth):
    // the site's own columns (ADR-0026). A goal in the funnel is shown as a goal, not twice.
    const steps = funnel.slice(1).filter((st): st is { event: string } => 'event' in st);
    const columns = [
      ...steps.map(
        (st, i) =>
          Prisma.sql`count(DISTINCT "visitorId") FILTER (WHERE ${stepSql(st, goals)})::int AS ${Prisma.raw(`"s${i}"`)}`,
      ),
      ...goals.flatMap((g, i) => goalColumns(g, i)),
    ];
    // Goals reached without a known source (a purchase reported by the shop's server) are a row
    // of their own — unless one channel is looked at.
    const anyGoal = goals.length
      ? Prisma.join(
          goals.map((g) => goalSql(g.rule)),
          ' OR ',
        )
      : Prisma.sql`false`;
    const rows = await this.prisma.client.$queryRaw<Record<string, number | string | null>[]>`
      SELECT coalesce(nullif(nullif(${group}, ''), ' / '), '(none)') AS label,
        (count(DISTINCT "sessionId") FILTER (WHERE consent AND name = 'PageView')
          + count(*) FILTER (WHERE NOT consent AND name = 'PageView'))::int AS visits,
        count(DISTINCT "visitorId") FILTER (WHERE name = 'PageView')::int AS visitors
        ${columns.length ? Prisma.sql`, ${Prisma.join(columns)}` : Prisma.empty}
      FROM website_event
      WHERE "siteId" = ${site.id}::uuid AND "occurredAt" >= ${since} AND NOT "isBot"
        AND ("channel" IS NOT NULL OR ((${anyGoal}) AND ${channel ? Prisma.sql`false` : Prisma.sql`true`})) ${within}
      GROUP BY 1 ORDER BY visits DESC LIMIT 200`;
    return {
      days: n,
      currency: await this.currency(site.id),
      steps,
      goals: goals.map(({ id, name, valued }) => ({ id, name: name ?? null, valued: !!valued })),
      rows: rows.map((r) => ({
        label: r['label'] as string,
        visits: r['visits'] as number,
        visitors: r['visitors'] as number,
        steps: steps.map((_, i) => r[`s${i}`] as number),
        goals: goals.map((_, i) => ({
          conversions: r[`g${i}c`] as number,
          visitors: r[`g${i}v`] as number,
          value: (r[`g${i}s`] as number | null) ?? null,
        })),
      })),
    };
  }

  /** The site's currency: the latest one an event with a value reported. */
  private async currency(siteId: string): Promise<string | null> {
    const rows = await this.prisma.client.$queryRaw<{ currency: string | null }[]>`
      SELECT properties->>'currency' AS currency FROM website_event
      WHERE "siteId" = ${siteId}::uuid AND properties->>'currency' IS NOT NULL
      ORDER BY "occurredAt" DESC LIMIT 1`;
    return rows[0]?.currency ?? null;
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
    const { n, since } = periodOf(days, site.timeZone);
    const db = this.prisma.client;
    const sid = site.id;
    const base = Prisma.sql`"siteId" = ${sid}::uuid AND "occurredAt" >= ${since} AND NOT "isBot" AND "visitorId" IS NOT NULL`;
    const [steps, fields, failures, delivery, payment] = await Promise.all([
      db.$queryRaw<{ name: string; visitors: number }[]>`
        SELECT name, count(DISTINCT "visitorId")::int AS visitors FROM website_event
        WHERE ${base} AND name IN (${Prisma.join([...CHECKOUT_STEPS])}) GROUP BY name`,
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
    const { n, since } = periodOf(days, site.timeZone);
    const db = this.prisma.client;
    const sid = site.id;
    const { goals, funnel: steps, tabs } = site.settings;
    const stepColumns = steps.map(
      (st, i) =>
        Prisma.sql`count(DISTINCT "visitorId") FILTER (WHERE ${stepSql(st, goals)})::int AS ${Prisma.raw(`"s${i}"`)}`,
    );
    const goalStats = goals.length
      ? db.$queryRaw<Record<string, number | null>[]>`
          SELECT ${Prisma.join(goals.flatMap((g, i) => goalColumns(g, i)))}
          FROM website_event
          WHERE "siteId" = ${sid}::uuid AND "occurredAt" >= ${since} AND NOT "isBot"`
      : Promise.resolve([{}] as Record<string, number | null>[]);
    const [counts, daily, funnel, channels, products, consent, reached] = await Promise.all([
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
      // The site's funnel (ADR-0026): visitors who agreed, so a person is known across steps.
      db.$queryRaw<Record<string, number>[]>`
        SELECT ${Prisma.join(stepColumns)} FROM website_event
        WHERE "siteId" = ${sid}::uuid AND "occurredAt" >= ${since} AND NOT "isBot"
          AND "visitorId" IS NOT NULL`,
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
      // Products only where the kind has them (a shop).
      !tabs.includes('products')
        ? Promise.resolve([] as { item: string; views: number; visitors: number }[])
        : db.$queryRaw<{ item: string; views: number; visitors: number }[]>`
        SELECT properties->>'item_id' AS item, count(*)::int AS views,
               count(DISTINCT coalesce("visitorId", "dailyId"))::int AS visitors
        FROM website_event
        WHERE "siteId" = ${sid}::uuid AND "occurredAt" >= ${since} AND NOT "isBot"
          AND name = 'ProductView' AND properties->>'item_id' IS NOT NULL
        GROUP BY 1 ORDER BY views DESC, visitors DESC LIMIT 100`,
      db.$queryRaw<{ consenting: number; anonymous: number }[]>`
        SELECT count(*) FILTER (WHERE consent)::int AS consenting,
               count(*) FILTER (WHERE NOT consent)::int AS anonymous
        FROM website_event
        WHERE "siteId" = ${sid}::uuid AND "occurredAt" >= ${since} AND NOT "isBot"`,
      goalStats,
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
    const f = funnel[0] ?? {};
    const r = reached[0] ?? {};
    return {
      days: n,
      kind: site.settings.kind,
      tabs,
      currency: goals.some((g) => g.valued) ? await this.currency(sid) : null,
      counts,
      daily,
      funnel: steps.map((step, i) => ({ ...step, visitors: f[`s${i}`] ?? 0 })),
      goals: goals.map((g, i) => ({
        id: g.id,
        name: g.name ?? null,
        valued: !!g.valued,
        conversions: r[`g${i}c`] ?? 0,
        visitors: r[`g${i}v`] ?? 0,
        value: r[`g${i}s`] ?? null,
      })),
      channels,
      products: named,
      consent: consent[0] ?? { consenting: 0, anonymous: 0 },
    };
  }
}

/** A goal's columns: conversions, people who reached it, and its worth (valued goals). */
function goalColumns(goal: Goal, i: number): Prisma.Sql[] {
  const when = goalSql(goal.rule);
  return [
    Prisma.sql`count(*) FILTER (WHERE ${when})::int AS ${Prisma.raw(`"g${i}c"`)}`,
    Prisma.sql`count(DISTINCT coalesce("visitorId", "dailyId", "eventId")) FILTER (WHERE ${when})::int AS ${Prisma.raw(`"g${i}v"`)}`,
    goal.valued
      ? Prisma.sql`sum(CASE WHEN ${when} AND jsonb_typeof(properties->'value') = 'number' THEN (properties->>'value')::numeric END)::float8 AS ${Prisma.raw(`"g${i}s"`)}`
      : Prisma.sql`NULL::float8 AS ${Prisma.raw(`"g${i}s"`)}`,
  ];
}
