import {
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { CONNECT_ROLES } from '../social/connect.service.js';
import { PrismaService } from '../prisma.service.js';
import {
  WorkspaceAccessGuard,
  WorkspaceRoles,
  type WorkspaceRequestContext,
} from '../workspaces/workspace-access.guard.js';
import { hashWorkerKey, newWorkerKey, workerState } from './gpu.js';

/** The workspace's GPU workers (ADR-0041): add a PC (its key is shown once), see its state, revoke it. */
@Controller('workspaces/:workspaceId/gpu/workers')
@UseGuards(WorkspaceAccessGuard)
export class GpuWorkersController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async list(@Req() request: { workspace: WorkspaceRequestContext }) {
    const rows = await this.prisma.client.gpuWorker.findMany({
      where: { workspaceId: request.workspace.workspaceId, revokedAt: null },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        name: true,
        keyPrefix: true,
        lastSeenAt: true,
        state: true,
        vramFreeMb: true,
        createdAt: true,
      },
    });
    return { workers: rows.map((w) => ({ ...w, status: workerState(w) })) };
  }

  @Post()
  @WorkspaceRoles(...CONNECT_ROLES)
  async create(
    @Body() body: { name?: unknown } | undefined,
    @Req() request: { workspace: WorkspaceRequestContext },
  ) {
    const name = (typeof body?.name === 'string' ? body.name.trim().slice(0, 80) : '') || 'PC';
    const key = newWorkerKey();
    const w = await this.prisma.client.gpuWorker.create({
      data: {
        workspaceId: request.workspace.workspaceId,
        name,
        keyHash: hashWorkerKey(key),
        keyPrefix: key.slice(0, 8),
      },
      select: { id: true, name: true, keyPrefix: true },
    });
    return { ...w, key };
  }

  @Delete(':id')
  @WorkspaceRoles(...CONNECT_ROLES)
  async revoke(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() request: { workspace: WorkspaceRequestContext },
  ) {
    const res = await this.prisma.client.gpuWorker.updateMany({
      where: { id, workspaceId: request.workspace.workspaceId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (!res.count) throw new NotFoundException();
    return { ok: true };
  }
}
