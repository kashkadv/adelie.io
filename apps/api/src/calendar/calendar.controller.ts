import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
  HttpException,
} from '@nestjs/common';
import { Prisma } from '@adelie/db';
import { Session, type UserSession } from '@thallesp/nestjs-better-auth';
import { OpenAiProvider, costMicros } from '../ai/provider.js';
import { config } from '../config.js';
import { CONNECT_ROLES } from '../social/connect.service.js';
import { PrismaService } from '../prisma.service.js';
import { visibleProjectsWhere } from '../workspaces/project-visibility.js';
import {
  WorkspaceAccessGuard,
  WorkspaceRoles,
  type WorkspaceRequestContext,
} from '../workspaces/workspace-access.guard.js';
import { buildLinkUrl, carriedLinks, channelOf } from '../links/links.js';
import { linkResults } from '../links/link-stats.js';
import { shortUrlOf } from '../links/short-links.js';
import {
  addDays,
  asDate,
  dayOf,
  isDay,
  isPublished,
  parseBudget,
  parseItem,
  weekStartOf,
  type ItemInput,
} from './calendar.js';
import {
  IDEAS_INSTRUCTIONS,
  IDEAS_SCHEMA,
  ideasInput,
  parseBrief,
  parseIdeas,
  type IdeasContext,
} from './ideas.js';

const LINK = {
  select: {
    id: true,
    code: true,
    name: true,
    destination: true,
    source: true,
    medium: true,
    campaign: true,
    content: true,
    publishedAt: true,
  },
} as const;
const POST = {
  select: {
    id: true,
    title: true,
    thumbnailUrl: true,
    url: true,
    publishedAt: true,
    account: { select: { platform: true } },
    latest: {
      select: {
        impressions: true,
        saves: true,
        outboundClicks: true,
        views: true,
        reach: true,
        likes: true,
        comments: true,
        shares: true,
        videoViews: true,
      },
    },
  },
} as const;
const ITEM_SELECT = {
  id: true,
  date: true,
  position: true,
  channel: true,
  format: true,
  title: true,
  notes: true,
  minutes: true,
  status: true,
  why: true,
  evidence: true,
  link: LINK,
  post: POST,
} as const;
type ItemRow = Prisma.CalendarItemGetPayload<{ select: typeof ITEM_SELECT }>;

/** An item as the cabinet shows it: its day as `YYYY-MM-DD`, its link with both forms. */
function present(item: ItemRow) {
  const { link, ...rest } = item;
  return {
    ...rest,
    date: item.date ? dayOf(item.date) : null,
    link: link
      ? {
          id: link.id,
          code: link.code,
          name: link.name,
          channel: channelOf(link.source, link.medium),
          campaign: link.campaign,
          content: link.content,
          url: buildLinkUrl(link.destination, link),
          shortUrl: link.publishedAt ? shortUrlOf(link.code) : null,
        }
      : null,
  };
}

/**
 * The content calendar (ADR-0028): planned publications by day, ideas without a day, the project's
 * daily time budget, and the weekly review — what the week's publications brought.
 */
@Controller('workspaces/:workspaceId/projects/:projectId/calendar')
@UseGuards(WorkspaceAccessGuard)
export class CalendarController {
  constructor(private readonly prisma: PrismaService) {}

  private async visibleProject(ctx: WorkspaceRequestContext, projectId: string) {
    const project = await this.prisma.client.project.findFirst({
      where: { id: projectId, ...visibleProjectsWhere(ctx) },
      select: { id: true, dailyMinutes: true },
    });
    if (!project) throw new NotFoundException();
    return project;
  }

  private async itemOf(ctx: WorkspaceRequestContext, projectId: string, id: string) {
    await this.visibleProject(ctx, projectId);
    const item = await this.prisma.client.calendarItem.findFirst({
      where: { id, projectId, workspaceId: ctx.workspaceId },
      select: { id: true, date: true, status: true, linkId: true },
    });
    if (!item) throw new NotFoundException();
    return item;
  }

  /** The link must be the project's own. */
  private async checkLink(
    projectId: string,
    workspaceId: string,
    linkId: string | null | undefined,
  ) {
    if (!linkId) return;
    const link = await this.prisma.client.trackedLink.findFirst({
      where: { id: linkId, projectId, workspaceId },
      select: { id: true },
    });
    if (!link) throw new BadRequestException({ errors: { linkId: 'invalid' } });
  }

  /**
   * Planned items whose link has appeared in a synced post become published with that post (and
   * get its day if they had none). Checked when the calendar is read: there are few such items.
   */
  private async matchPublished(projectId: string, workspaceId: string) {
    const db = this.prisma.client;
    const waiting = await db.calendarItem.findMany({
      where: {
        projectId,
        workspaceId,
        postId: null,
        linkId: { not: null },
        status: { in: ['idea', 'draft', 'ready'] },
      },
      select: {
        id: true,
        date: true,
        link: { select: { code: true, source: true, content: true } },
      },
    });
    if (!waiting.length) return;
    const candidates = await db.socialPostLink.findMany({
      where: {
        projectId,
        workspaceId,
        OR: waiting.flatMap(({ link }) => [
          { url: { contains: `go.adelie.space/${link!.code}` } },
          { url: { contains: `utm_content=${link!.content}`, mode: 'insensitive' as const } },
          {
            url: {
              contains: `utm_content=${encodeURIComponent(link!.content)}`,
              mode: 'insensitive' as const,
            },
          },
        ]),
      },
      select: { url: true, post: { select: { id: true, publishedAt: true } } },
    });
    for (const item of waiting) {
      const found = candidates.find((c) => carriedLinks([c.url]).has(item.link!));
      if (!found) continue;
      await db.calendarItem.update({
        where: { id: item.id },
        data: {
          postId: found.post.id,
          status: 'published',
          ...(item.date || !found.post.publishedAt
            ? {}
            : { date: asDate(dayOf(found.post.publishedAt)) }),
        },
      });
    }
  }

  /** Items from `from` to `to` (days, inclusive), the ideas, and the daily budget. */
  @Get()
  async list(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Query('from') from: string | undefined,
    @Query('to') to: string | undefined,
    @Req() request: { workspace: WorkspaceRequestContext },
  ) {
    if (!isDay(from) || !isDay(to) || from > to || addDays(from, 62) < to) {
      throw new BadRequestException({ errors: { period: 'invalid' } });
    }
    const ctx = request.workspace;
    const project = await this.visibleProject(ctx, projectId);
    await this.matchPublished(projectId, ctx.workspaceId);
    const items = await this.prisma.client.calendarItem.findMany({
      where: {
        projectId,
        workspaceId: ctx.workspaceId,
        OR: [{ date: { gte: asDate(from), lte: asDate(to) } }, { date: null }],
      },
      orderBy: [{ date: 'asc' }, { position: 'asc' }, { createdAt: 'asc' }],
      select: ITEM_SELECT,
    });
    return { dailyMinutes: project.dailyMinutes, items: items.map(present) };
  }

  @Post()
  @WorkspaceRoles(...CONNECT_ROLES)
  async create(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() body: Record<string, unknown> | undefined,
    @Req() request: { workspace: WorkspaceRequestContext },
  ) {
    const ctx = request.workspace;
    await this.visibleProject(ctx, projectId);
    const parsed = parseItem(body ?? {}, true);
    if (!parsed.ok) throw new BadRequestException({ errors: { [parsed.error]: 'invalid' } });
    const input = parsed.item as Required<Pick<ItemInput, 'channel' | 'format' | 'title'>> &
      ItemInput;
    await this.checkLink(projectId, ctx.workspaceId, input.linkId);
    // A new item goes last in its day.
    const last = await this.prisma.client.calendarItem.aggregate({
      where: { projectId, date: input.date ? asDate(input.date) : null },
      _max: { position: true },
    });
    const item = await this.prisma.client.calendarItem.create({
      data: {
        workspaceId: ctx.workspaceId,
        projectId,
        channel: input.channel,
        format: input.format,
        title: input.title,
        notes: input.notes ?? null,
        minutes: input.minutes ?? null,
        status: input.status ?? 'idea',
        linkId: input.linkId ?? null,
        date: input.date ? asDate(input.date) : null,
        position: input.position ?? (last._max.position ?? -1) + 1,
      },
      select: ITEM_SELECT,
    });
    return present(item);
  }

  /** Changes an item: any of its fields, its day and place (moving), its link. */
  @Patch(':id')
  @WorkspaceRoles(...CONNECT_ROLES)
  async update(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: Record<string, unknown> | undefined,
    @Req() request: { workspace: WorkspaceRequestContext },
  ) {
    const ctx = request.workspace;
    const current = await this.itemOf(ctx, projectId, id);
    const parsed = parseItem(body ?? {}, false);
    if (!parsed.ok) throw new BadRequestException({ errors: { [parsed.error]: 'invalid' } });
    const { date, linkId, ...rest } = parsed.item;
    await this.checkLink(projectId, ctx.workspaceId, linkId);
    const data: Prisma.CalendarItemUncheckedUpdateInput = { ...rest };
    if (date !== undefined) data.date = date ? asDate(date) : null;
    if (linkId !== undefined) {
      data.linkId = linkId;
      // Another link: the post found by the old one is not this item's any more.
      if (linkId !== current.linkId) data.postId = null;
    }
    // Back before "published" by hand: the found post stays attached, so it is not matched (and
    // published) again — the owner's word wins; another link starts the matching anew.
    const item = await this.prisma.client.calendarItem.update({
      where: { id },
      data,
      select: ITEM_SELECT,
    });
    return present(item);
  }

  @Delete(':id')
  @HttpCode(204)
  @WorkspaceRoles(...CONNECT_ROLES)
  async remove(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() request: { workspace: WorkspaceRequestContext },
  ) {
    await this.itemOf(request.workspace, projectId, id);
    await this.prisma.client.calendarItem.delete({ where: { id } });
  }

  /** The project's daily time budget for publications; null removes it. */
  @Patch()
  @WorkspaceRoles(...CONNECT_ROLES)
  async settings(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() body: { dailyMinutes?: unknown } | undefined,
    @Req() request: { workspace: WorkspaceRequestContext },
  ) {
    await this.visibleProject(request.workspace, projectId);
    const dailyMinutes = parseBudget(body?.dailyMinutes);
    if (dailyMinutes === undefined) {
      throw new BadRequestException({ errors: { dailyMinutes: 'invalid' } });
    }
    await this.prisma.client.project.update({ where: { id: projectId }, data: { dailyMinutes } });
    return { dailyMinutes };
  }

  /**
   * The week starting on the Monday of `week`: plan and fact, every item with what its link and
   * post brought since the week began, totals by channel and format, and the owner's conclusion.
   */
  @Get('review')
  async review(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Query('week') week: string | undefined,
    @Req() request: { workspace: WorkspaceRequestContext },
  ) {
    if (!isDay(week)) throw new BadRequestException({ errors: { week: 'invalid' } });
    const ctx = request.workspace;
    const project = await this.visibleProject(ctx, projectId);
    await this.matchPublished(projectId, ctx.workspaceId);
    const start = weekStartOf(week);
    const db = this.prisma.client;
    const [items, saved] = await Promise.all([
      db.calendarItem.findMany({
        where: {
          projectId,
          workspaceId: ctx.workspaceId,
          date: { gte: asDate(start), lte: asDate(addDays(start, 6)) },
        },
        orderBy: [{ date: 'asc' }, { position: 'asc' }],
        select: ITEM_SELECT,
      }),
      db.weeklyReview.findUnique({
        where: { projectId_weekStart: { projectId, weekStart: asDate(start) } },
        select: { notes: true, updatedAt: true },
      }),
    ]);
    const links = items.flatMap((i) => (i.link ? [i.link] : []));
    const results = await linkResults(db, projectId, ctx.workspaceId, links, asDate(start));
    const rows = items.map((i) => ({
      ...present(i),
      result: i.link ? (results.get(i.link.id) ?? null) : null,
    }));
    const published = rows.filter((r) => isPublished(r.status));
    const minutes = (list: typeof rows) => list.reduce((n, r) => n + (r.minutes ?? 0), 0);
    const groupBy = (field: 'channel' | 'format') => {
      const groups = new Map<
        string,
        {
          key: string;
          planned: number;
          published: number;
          clicks: number;
          visits: number;
          goals: number;
        }
      >();
      for (const r of rows) {
        const g = groups.get(r[field]) ?? {
          key: r[field],
          planned: 0,
          published: 0,
          clicks: 0,
          visits: 0,
          goals: 0,
        };
        g.planned += 1;
        if (isPublished(r.status)) {
          g.published += 1;
          g.clicks += r.result?.clicks ?? 0;
          g.visits += r.result?.site?.visits ?? 0;
          g.goals += r.result?.site?.conversions ?? 0;
        }
        groups.set(r[field], g);
      }
      return [...groups.values()].sort((a, b) => b.visits + b.clicks - (a.visits + a.clicks));
    };
    return {
      weekStart: start,
      dailyMinutes: project.dailyMinutes,
      plan: { items: rows.length, minutes: minutes(rows) },
      fact: { items: published.length, minutes: minutes(published) },
      items: rows,
      byChannel: groupBy('channel'),
      byFormat: groupBy('format'),
      review: saved ? { notes: saved.notes, updatedAt: saved.updatedAt } : null,
    };
  }

  /** Saves the owner's conclusion; the week's published items become "measured". */
  @Put('review')
  @WorkspaceRoles(...CONNECT_ROLES)
  async saveReview(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() body: { week?: unknown; notes?: unknown } | undefined,
    @Req() request: { workspace: WorkspaceRequestContext },
  ) {
    if (!isDay(body?.week)) throw new BadRequestException({ errors: { week: 'invalid' } });
    const notes = typeof body?.notes === 'string' ? body.notes.slice(0, 10_000).trim() : '';
    const ctx = request.workspace;
    await this.visibleProject(ctx, projectId);
    const start = weekStartOf(body.week);
    const db = this.prisma.client;
    const [review] = await db.$transaction([
      db.weeklyReview.upsert({
        where: { projectId_weekStart: { projectId, weekStart: asDate(start) } },
        create: { workspaceId: ctx.workspaceId, projectId, weekStart: asDate(start), notes },
        update: { notes },
        select: { notes: true, updatedAt: true },
      }),
      db.calendarItem.updateMany({
        where: {
          projectId,
          workspaceId: ctx.workspaceId,
          status: 'published',
          date: { gte: asDate(start), lte: asDate(addDays(start, 6)) },
        },
        data: { status: 'measured' },
      }),
    ]);
    return { review };
  }

  /** This month's AI spending of the project, in millionths of a dollar. */
  private async spentMicros(projectId: string) {
    const now = new Date();
    const month = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const sum = await this.prisma.client.aiRun.aggregate({
      where: { projectId, createdAt: { gte: month } },
      _sum: { costMicros: true },
    });
    return sum._sum.costMicros ?? 0;
  }

  /** The project's brief, and whether AI is available and how much of the month's limit is used. */
  @Get('brief')
  async brief(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Req() request: { workspace: WorkspaceRequestContext },
  ) {
    await this.visibleProject(request.workspace, projectId);
    const row = await this.prisma.client.project.findUnique({
      where: { id: projectId },
      select: { brief: true },
    });
    return {
      brief: parseBrief(row?.brief),
      ai: config.ai
        ? {
            enabled: true,
            model: config.ai.model,
            spentUsd: (await this.spentMicros(projectId)) / 1e6,
            limitUsd: config.ai.monthlyLimitUsd,
          }
        : { enabled: false },
    };
  }

  @Put('brief')
  @WorkspaceRoles(...CONNECT_ROLES)
  async saveBrief(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() body: unknown,
    @Req() request: { workspace: WorkspaceRequestContext },
  ) {
    await this.visibleProject(request.workspace, projectId);
    const brief = parseBrief(body);
    if (!brief) throw new BadRequestException({ errors: { about: 'invalid' } });
    await this.prisma.client.project.update({
      where: { id: projectId },
      data: { brief: brief as unknown as Prisma.InputJsonValue },
    });
    return { brief };
  }

  /**
   * Ideas for the week from the AI (ADR-0029): from the brief, the budget, the last four weeks'
   * results and the best posts; saved as ideas (no day) with why and on what evidence.
   */
  @Post('ideas')
  @WorkspaceRoles(...CONNECT_ROLES)
  async ideas(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() body: { week?: unknown; locale?: unknown } | undefined,
    @Req() request: { workspace: WorkspaceRequestContext },
    @Session() session: UserSession,
  ) {
    const ai = config.ai;
    if (!ai) throw new HttpException({ errors: { ai: 'off' } }, 503);
    if (!isDay(body?.week)) throw new BadRequestException({ errors: { week: 'invalid' } });
    const ctx = request.workspace;
    await this.visibleProject(ctx, projectId);
    const db = this.prisma.client;
    const project = (await db.project.findUnique({
      where: { id: projectId },
      select: { name: true, brief: true, dailyMinutes: true },
    }))!;
    const brief = parseBrief(project.brief);
    if (!brief) throw new BadRequestException({ errors: { brief: 'missing' } });
    if ((await this.spentMicros(projectId)) >= ai.monthlyLimitUsd * 1e6) {
      throw new HttpException({ errors: { ai: 'limit' } }, 429);
    }
    await this.matchPublished(projectId, ctx.workspaceId);

    const start = weekStartOf(body.week);
    const since = addDays(start, -28);
    const where = { projectId, workspaceId: ctx.workspaceId };
    const [accounts, planned, past, posts] = await Promise.all([
      db.socialAccount.findMany({
        where: { ...where, hiddenAt: null, connection: { status: { not: 'REVOKED' } } },
        select: { platform: true },
      }),
      db.calendarItem.findMany({
        where: {
          ...where,
          OR: [{ date: null }, { date: { gte: asDate(start), lte: asDate(addDays(start, 6)) } }],
        },
        select: { date: true, title: true, channel: true, format: true, minutes: true },
      }),
      db.calendarItem.findMany({
        where: { ...where, date: { gte: asDate(since), lt: asDate(start) } },
        orderBy: { date: 'asc' },
        select: ITEM_SELECT,
      }),
      db.socialPost.findMany({
        where: {
          ...where,
          publishedAt: { gte: new Date(Date.now() - 90 * 86_400_000) },
          account: { hiddenAt: null },
          latest: { isNot: null },
        },
        select: {
          title: true,
          publishedAt: true,
          account: { select: { platform: true } },
          latest: POST.select.latest,
        },
      }),
    ]);
    const links = past.flatMap((i) => (i.link ? [i.link] : []));
    const results = await linkResults(db, projectId, ctx.workspaceId, links, asDate(since));
    const reach = (l: (typeof posts)[number]['latest']) =>
      (l?.impressions ?? l?.views ?? l?.videoViews ?? 0) as number;
    const numbers = (l: (typeof posts)[number]['latest']) =>
      Object.fromEntries(Object.entries(l ?? {}).filter(([, v]) => typeof v === 'number'));
    const context: IdeasContext = {
      project: project.name,
      brief,
      dailyMinutes: project.dailyMinutes,
      connected: [...new Set(accounts.map((a) => a.platform))],
      weekStart: start,
      planned: planned.map((p) => ({ ...p, date: p.date ? dayOf(p.date) : null })),
      history: past.map((i) => {
        const r = i.link ? results.get(i.link.id) : undefined;
        return {
          date: i.date ? dayOf(i.date) : null,
          title: i.title,
          channel: i.channel,
          format: i.format,
          minutes: i.minutes,
          status: i.status,
          ...(r
            ? {
                linkClicks: r.clicks,
                siteVisits: r.site?.visits ?? null,
                siteGoals: r.site?.conversions ?? null,
              }
            : {}),
          ...(i.post ? { post: numbers(i.post.latest) } : {}),
        };
      }),
      topPosts: posts
        .sort((a, b) => reach(b.latest) - reach(a.latest))
        .slice(0, 12)
        .map((p) => ({
          platform: p.account.platform,
          title: (p.title ?? '').slice(0, 140),
          published: p.publishedAt ? dayOf(p.publishedAt) : null,
          ...numbers(p.latest),
        })),
      ownerLanguage: body?.locale === 'uk' ? 'Ukrainian' : 'English',
    };

    const provider = new OpenAiProvider(ai.apiKey, ai.model);
    const answer = await provider.structured({
      instructions: IDEAS_INSTRUCTIONS,
      input: ideasInput(context),
      schema: IDEAS_SCHEMA as unknown as Record<string, unknown>,
      schemaName: 'calendar_ideas',
    });
    const ideas = answer.ok ? parseIdeas(answer.data) : [];
    const run = await db.aiRun.create({
      data: {
        workspaceId: ctx.workspaceId,
        projectId,
        userId: session.user.id,
        kind: 'calendar_ideas',
        provider: provider.name,
        model: answer.model,
        status: answer.ok && ideas.length ? 'ok' : 'error',
        inputTokens: answer.usage.inputTokens,
        cachedTokens: answer.usage.cachedTokens,
        outputTokens: answer.usage.outputTokens,
        costMicros: costMicros(answer.usage, ai.price),
        input: context as unknown as Prisma.InputJsonValue,
        output: answer.ok ? (answer.data as Prisma.InputJsonValue) : Prisma.DbNull,
        error: answer.ok ? (ideas.length ? null : 'no valid ideas') : answer.error,
      },
      select: { id: true, costMicros: true },
    });
    if (!ideas.length) throw new HttpException({ errors: { ai: 'failed' } }, 502);

    const last = await db.calendarItem.aggregate({
      where: { projectId, date: null },
      _max: { position: true },
    });
    const first = (last._max.position ?? -1) + 1;
    await db.calendarItem.createMany({
      data: ideas.map((idea, i) => ({
        workspaceId: ctx.workspaceId,
        projectId,
        date: null,
        position: first + i,
        channel: idea.channel,
        format: idea.format,
        title: idea.title,
        notes: idea.notes || null,
        minutes: idea.minutes,
        status: 'idea',
        why: idea.why || null,
        evidence: idea.evidence,
        aiRunId: run.id,
      })),
    });
    return {
      created: ideas.length,
      costUsd: run.costMicros / 1e6,
      spentUsd: (await this.spentMicros(projectId)) / 1e6,
      limitUsd: ai.monthlyLimitUsd,
    };
  }
}
