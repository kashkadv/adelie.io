import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { WorkspaceRole } from '@adelie/db';
import { PrismaService } from '../prisma.service.js';
import { visibleProjectsWhere } from '../workspaces/project-visibility.js';
import {
  WorkspaceAccessGuard,
  WorkspaceRoles,
  type WorkspaceRequestContext,
} from '../workspaces/workspace-access.guard.js';
import { parseProjectInput } from './project-input.js';

/** Who creates and deletes projects: they see all of them anyway (ADR-0007, ADR-0014). */
const MANAGE_ROLES: WorkspaceRole[] = ['OWNER', 'ADMIN'];
/** Who edits a project's settings (in projects visible to them). */
const EDIT_ROLES: WorkspaceRole[] = ['OWNER', 'ADMIN', 'MANAGER'];

const PROJECT_SELECT = {
  id: true,
  name: true,
  timezone: true,
  currency: true,
  reportLocale: true,
} as const;

/** Projects of a workspace (ADR-0007): create, change settings, delete. */
@Controller('workspaces/:workspaceId/projects')
@UseGuards(WorkspaceAccessGuard)
export class ProjectsController {
  constructor(private readonly prisma: PrismaService) {}

  @Post()
  @WorkspaceRoles(...MANAGE_ROLES)
  async create(@Body() body: unknown, @Req() request: { workspace: WorkspaceRequestContext }) {
    const parsed = parseProjectInput(body, true);
    if (!parsed.ok) throw new BadRequestException({ errors: parsed.errors });
    return this.prisma.client.project.create({
      data: { ...parsed.data, name: parsed.data.name!, workspaceId: request.workspace.workspaceId },
      select: PROJECT_SELECT,
    });
  }

  @Patch(':projectId')
  @WorkspaceRoles(...EDIT_ROLES)
  async update(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() body: unknown,
    @Req() request: { workspace: WorkspaceRequestContext },
  ) {
    await this.visibleProject(request.workspace, projectId);
    const parsed = parseProjectInput(body, false);
    if (!parsed.ok) throw new BadRequestException({ errors: parsed.errors });
    return this.prisma.client.project.update({
      where: { id: projectId },
      data: parsed.data,
      select: PROJECT_SELECT,
    });
  }

  /**
   * Deletes a project with its accounts and everything collected for them — irreversible. The
   * caller repeats the project name; the last project of a workspace cannot be deleted.
   */
  @Delete(':projectId')
  @WorkspaceRoles(...MANAGE_ROLES)
  async remove(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() body: { confirm?: unknown },
    @Req() request: { workspace: WorkspaceRequestContext },
  ) {
    const project = await this.visibleProject(request.workspace, projectId);
    const typed = typeof body?.confirm === 'string' ? body.confirm.trim().toLowerCase() : '';
    if (typed !== project.name.toLowerCase()) {
      throw new BadRequestException({ errors: { confirm: 'mismatch' } });
    }
    const count = await this.prisma.client.project.count({
      where: { workspaceId: request.workspace.workspaceId },
    });
    if (count <= 1) throw new ConflictException({ errors: { project: 'lastProject' } });
    // Cascades: connections → accounts → boards, posts, metrics, sync runs; members; invitations.
    await this.prisma.client.project.delete({ where: { id: projectId } });
    return { ok: true };
  }

  private async visibleProject(ctx: WorkspaceRequestContext, projectId: string) {
    const project = await this.prisma.client.project.findFirst({
      where: { id: projectId, ...visibleProjectsWhere(ctx) },
      select: { id: true, name: true },
    });
    if (!project) throw new NotFoundException();
    return project;
  }
}
