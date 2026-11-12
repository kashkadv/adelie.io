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
} from '@nestjs/common';
import type { Prisma } from '@adelie/db';
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
}
