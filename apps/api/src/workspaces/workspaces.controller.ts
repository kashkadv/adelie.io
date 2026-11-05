import { Controller, Get, Param, ParseUUIDPipe, UseGuards } from '@nestjs/common';
import { Session, type UserSession } from '@thallesp/nestjs-better-auth';
import { PrismaService } from '../prisma.service.js';
import { WorkspaceAccessGuard } from './workspace-access.guard.js';

@Controller('workspaces')
export class WorkspacesController {
  constructor(private readonly prisma: PrismaService) {}

  /** Workspaces the current user is a member of. */
  @Get()
  async list(@Session() session: UserSession) {
    const memberships = await this.prisma.client.workspaceMember.findMany({
      where: { userId: session.user.id },
      select: { role: true, workspace: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'asc' },
    });
    return memberships.map((m) => ({ ...m.workspace, role: m.role }));
  }

  @Get(':workspaceId')
  @UseGuards(WorkspaceAccessGuard)
  async get(@Param('workspaceId', ParseUUIDPipe) workspaceId: string) {
    return this.prisma.client.workspace.findUniqueOrThrow({
      where: { id: workspaceId },
      select: { id: true, name: true, timezone: true, currency: true, createdAt: true },
    });
  }
}
