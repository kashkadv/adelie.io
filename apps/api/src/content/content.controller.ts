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

/** Sortable columns: lifetime metrics from PostMetricsLatest, or the publication date. */
const SORTS = [
  'impressions',
  'saves',
  'pinClicks',
  'outboundClicks',
  'videoViews',
  'publishedAt',
] as const;
type Sort = (typeof SORTS)[number];
const PAGE_SIZE = 50;

/**
 * Project content (pins) with their latest lifetime metrics (ADR-0008: the derived
 * PostMetricsLatest table exists exactly for sorting and top lists). Posts without metrics are
 * listed too and always sort last — missing data is never treated as zero.
 */
@Controller('workspaces/:workspaceId/projects/:projectId')
@UseGuards(WorkspaceAccessGuard)
export class ContentController {
  constructor(private readonly prisma: PrismaService) {}

  private async visibleProject(ctx: WorkspaceRequestContext, projectId: string) {
    const project = await this.prisma.client.project.findFirst({
      where: { id: projectId, ...visibleProjectsWhere(ctx) },
      select: { id: true },
    });
    if (!project) throw new NotFoundException();
  }

  @Get('content')
  async list(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Query() query: Record<string, string | undefined>,
    @Req() request: { workspace: WorkspaceRequestContext },
  ) {
    await this.visibleProject(request.workspace, projectId);
    const sort = (query['sort'] ?? 'impressions') as Sort;
    if (!SORTS.includes(sort)) throw new BadRequestException('Unknown sort');
    const page = Math.max(0, Number(query['page'] ?? 0) || 0);

    // Own posts by default: posts saved from other accounts carry no metrics (Pinterest repins).
    const ownership = query['ownership'] ?? 'own';
    if (!['own', 'saved', 'all'].includes(ownership))
      throw new BadRequestException('Unknown ownership');
    // Publication date range, inclusive calendar days (UTC).
    const day = /^\d{4}-\d{2}-\d{2}$/;
    const from = query['from'];
    const to = query['to'];
    if ((from && !day.test(from)) || (to && !day.test(to)))
      throw new BadRequestException('Dates must be YYYY-MM-DD');
    const publishedAt =
      from || to
        ? {
            ...(from ? { gte: new Date(`${from}T00:00:00Z`) } : {}),
            ...(to ? { lt: new Date(new Date(`${to}T00:00:00Z`).getTime() + 86_400_000) } : {}),
          }
        : undefined;
    const where: Prisma.SocialPostWhereInput = {
      projectId,
      ...(publishedAt ? { publishedAt } : {}),
      ...(ownership === 'all' ? {} : { isOwn: ownership === 'own' }),
      workspaceId: request.workspace.workspaceId,
      ...(query['accountId'] ? { accountId: query['accountId'] } : {}),
      // Disconnected accounts are hidden: their history is kept and returns on reconnect.
      account: { connection: { status: { not: 'REVOKED' } } },
      ...(query['boardId'] ? { boardId: query['boardId'] } : {}),
    };
    const orderBy: Prisma.SocialPostOrderByWithRelationInput[] =
      sort === 'publishedAt'
        ? [{ publishedAt: { sort: 'desc', nulls: 'last' } }, { id: 'asc' }]
        : [
            { latest: { [sort]: { sort: 'desc', nulls: 'last' } } },
            { publishedAt: { sort: 'desc', nulls: 'last' } },
            { id: 'asc' },
          ];

    const [total, posts] = await Promise.all([
      this.prisma.client.socialPost.count({ where }),
      this.prisma.client.socialPost.findMany({
        where,
        orderBy,
        skip: page * PAGE_SIZE,
        take: PAGE_SIZE,
        select: {
          id: true,
          externalId: true,
          url: true,
          title: true,
          description: true,
          thumbnailUrl: true,
          contentType: true,
          isOwn: true,
          publishedAt: true,
          board: { select: { id: true, name: true } },
          account: { select: { id: true, username: true, platform: true } },
          latest: {
            select: {
              impressions: true,
              saves: true,
              pinClicks: true,
              outboundClicks: true,
              videoViews: true,
              dataStatus: true,
              asOfDate: true,
            },
          },
        },
      }),
    ]);

    return {
      total,
      page,
      pageSize: PAGE_SIZE,
      items: posts.map(({ latest, ...p }) => ({
        ...p,
        metrics: latest
          ? {
              impressions: latest.impressions,
              saves: latest.saves,
              pinClicks: latest.pinClicks,
              outboundClicks: latest.outboundClicks,
              videoViews: latest.videoViews,
            }
          : null,
        dataStatus: latest?.dataStatus ?? null,
        asOf: latest?.asOfDate ?? null,
      })),
    };
  }

  /** Boards of the project's accounts, for the content filter. */
  @Get('boards')
  async boards(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Req() request: { workspace: WorkspaceRequestContext },
  ) {
    await this.visibleProject(request.workspace, projectId);
    return this.prisma.client.socialBoard.findMany({
      where: {
        projectId,
        workspaceId: request.workspace.workspaceId,
        account: { connection: { status: { not: 'REVOKED' } } },
      },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, accountId: true, pinCount: true },
    });
  }
}
