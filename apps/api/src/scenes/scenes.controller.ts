import { createReadStream } from 'node:fs';
import { unlink } from 'node:fs/promises';
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { Prisma } from '@adelie/db';
import { assetFile } from '../assets/storage.js';
import { bestState, workerState } from '../gpu/gpu.js';
import { CONNECT_ROLES } from '../social/connect.service.js';
import { PrismaService } from '../prisma.service.js';
import { visibleProjectsWhere } from '../workspaces/project-visibility.js';
import {
  WorkspaceAccessGuard,
  WorkspaceRoles,
  type WorkspaceRequestContext,
} from '../workspaces/workspace-access.guard.js';
import {
  LOCATION_KINDS,
  parseCandidateRequest,
  REJECTED_KEEP_MS,
  seedsFor,
  STATUSES,
} from './scenes.js';

type Ctx = { workspace: WorkspaceRequestContext };

const SCENE_SELECT = {
  id: true,
  locationId: true,
  status: true,
  name: true,
  number: true,
  style: true,
  light: true,
  angle: true,
  sizeClass: true,
  placement: true,
  productTypes: true,
  tags: true,
  minCm: true,
  maxCm: true,
  params: true,
  assetId: true,
  jobId: true,
  decidedAt: true,
  createdAt: true,
} satisfies Prisma.SceneSelect;

/**
 * Scene library of the Workshop (ADR-0042): locations the owner creates, scenes generated on the PC as candidates and
 * chosen into the library, the jobs that make them and the state of the PC.
 */
@Controller('workspaces/:workspaceId/projects/:projectId')
@UseGuards(WorkspaceAccessGuard)
export class ScenesController {
  constructor(private readonly prisma: PrismaService) {}

  private async project(ctx: WorkspaceRequestContext, projectId: string) {
    const project = await this.prisma.client.project.findFirst({
      where: { id: projectId, ...visibleProjectsWhere(ctx) },
      select: { id: true },
    });
    if (!project) throw new NotFoundException();
  }

  /** Deletes rejected candidates older than a week, with their files. */
  private async cleanUp(projectId: string) {
    const db = this.prisma.client;
    const old = await db.scene.findMany({
      where: {
        projectId,
        status: 'rejected',
        decidedAt: { lt: new Date(Date.now() - REJECTED_KEEP_MS) },
      },
      select: { id: true, assetId: true },
    });
    if (!old.length) return;
    await this.removeScenes(old);
  }

  private async removeScenes(scenes: { id: string; assetId: string | null }[]) {
    const db = this.prisma.client;
    const ids = scenes.map((s) => s.assetId).filter((v): v is string => !!v);
    const assets = await db.asset.findMany({
      where: { id: { in: ids } },
      select: { id: true, path: true },
    });
    await db.scene.deleteMany({ where: { id: { in: scenes.map((s) => s.id) } } });
    await db.asset.deleteMany({ where: { id: { in: ids } } });
    for (const a of assets) {
      const f = assetFile(a.path);
      if (f) await unlink(f).catch(() => undefined);
    }
  }

  /** Locations with counts, the scenes (filtered), recent jobs and the state of the PC. */
  @Get('scenes')
  async list(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Query('location') location: string | undefined,
    @Query('status') status: string | undefined,
    @Req() request: Ctx,
  ) {
    const ctx = request.workspace;
    await this.project(ctx, projectId);
    await this.cleanUp(projectId);
    const db = this.prisma.client;
    const [locations, counts, scenes, jobs, workers] = await Promise.all([
      db.sceneLocation.findMany({
        where: { projectId, workspaceId: ctx.workspaceId },
        orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
        select: { id: true, name: true, kind: true, description: true, position: true },
      }),
      db.scene.groupBy({
        by: ['locationId', 'status'],
        where: { projectId, workspaceId: ctx.workspaceId },
        _count: true,
      }),
      db.scene.findMany({
        where: {
          projectId,
          workspaceId: ctx.workspaceId,
          ...(location && /^[0-9a-f-]{36}$/i.test(location) ? { locationId: location } : {}),
          status:
            status && (STATUSES as readonly string[]).includes(status)
              ? status
              : { not: 'rejected' },
        },
        orderBy: [{ createdAt: 'desc' }, { number: 'asc' }],
        take: 500,
        select: SCENE_SELECT,
      }),
      db.gpuJob.findMany({
        where: {
          projectId,
          workspaceId: ctx.workspaceId,
          OR: [
            { status: { in: ['queued', 'running'] } },
            { finishedAt: { gte: new Date(Date.now() - 86_400_000) } },
          ],
        },
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: {
          id: true,
          kind: true,
          status: true,
          progress: true,
          error: true,
          params: true,
          createdAt: true,
          finishedAt: true,
        },
      }),
      db.gpuWorker.findMany({
        where: { workspaceId: ctx.workspaceId, revokedAt: null },
        select: { lastSeenAt: true, state: true },
      }),
    ]);
    return {
      locations: locations.map((l) => ({
        ...l,
        counts: Object.fromEntries(
          counts.filter((c) => c.locationId === l.id).map((c) => [c.status, c._count]),
        ),
      })),
      scenes,
      jobs,
      gpu: { state: bestState(workers.map((w) => workerState(w))), workers: workers.length },
    };
  }

  @Post('scene-locations')
  @WorkspaceRoles(...CONNECT_ROLES)
  async createLocation(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() body: Record<string, unknown> | undefined,
    @Req() request: Ctx,
  ) {
    const ctx = request.workspace;
    await this.project(ctx, projectId);
    const name = typeof body?.['name'] === 'string' ? body['name'].trim().slice(0, 80) : '';
    if (!name) throw new BadRequestException({ errors: { name: 'required' } });
    const rawKind = typeof body?.['kind'] === 'string' ? body['kind'] : '';
    const kind = (LOCATION_KINDS as readonly string[]).includes(rawKind) ? rawKind : 'other';
    const description =
      typeof body?.['description'] === 'string' ? body['description'].trim().slice(0, 1000) : '';
    const last = await this.prisma.client.sceneLocation.aggregate({
      where: { projectId },
      _max: { position: true },
    });
    return this.prisma.client.sceneLocation.create({
      data: {
        workspaceId: ctx.workspaceId,
        projectId,
        name,
        kind,
        description: description || null,
        position: (last._max.position ?? -1) + 1,
      },
      select: { id: true, name: true, kind: true, description: true, position: true },
    });
  }

  @Patch('scene-locations/:id')
  @WorkspaceRoles(...CONNECT_ROLES)
  async updateLocation(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: Record<string, unknown> | undefined,
    @Req() request: Ctx,
  ) {
    const ctx = request.workspace;
    await this.project(ctx, projectId);
    const data: Prisma.SceneLocationUpdateInput = {};
    if (typeof body?.['name'] === 'string') {
      const name = body['name'].trim().slice(0, 80);
      if (!name) throw new BadRequestException({ errors: { name: 'required' } });
      data.name = name;
    }
    if (body?.['kind'] !== undefined) {
      const kind = typeof body['kind'] === 'string' ? body['kind'] : '';
      if (!(LOCATION_KINDS as readonly string[]).includes(kind)) {
        throw new BadRequestException({ errors: { kind: 'invalid' } });
      }
      data.kind = kind;
    }
    if (typeof body?.['description'] === 'string')
      data.description = body['description'].trim().slice(0, 1000) || null;
    if (typeof body?.['position'] === 'number') data.position = Math.round(body['position']);
    const res = await this.prisma.client.sceneLocation.updateMany({
      where: { id, projectId, workspaceId: ctx.workspaceId },
      data: data as Prisma.SceneLocationUpdateManyMutationInput,
    });
    if (!res.count) throw new NotFoundException();
    return { ok: true };
  }

  /** A location can be deleted only without scenes in the library (candidates go with it). */
  @Delete('scene-locations/:id')
  @WorkspaceRoles(...CONNECT_ROLES)
  async deleteLocation(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() request: Ctx,
  ) {
    const ctx = request.workspace;
    await this.project(ctx, projectId);
    const db = this.prisma.client;
    const loc = await db.sceneLocation.findFirst({
      where: { id, projectId, workspaceId: ctx.workspaceId },
      select: { id: true },
    });
    if (!loc) throw new NotFoundException();
    const kept = await db.scene.count({
      where: { locationId: id, status: { in: ['library', 'archived'] } },
    });
    if (kept) throw new BadRequestException({ errors: { location: 'not_empty' } });
    await this.removeScenes(
      await db.scene.findMany({ where: { locationId: id }, select: { id: true, assetId: true } }),
    );
    await db.sceneLocation.delete({ where: { id } });
    return { ok: true };
  }

  /** New candidates: a job for the PC with the location's description and fresh seeds. */
  @Post('scenes/generate')
  @WorkspaceRoles(...CONNECT_ROLES)
  async generate(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() body: Record<string, unknown> | undefined,
    @Req() request: Ctx,
  ) {
    const ctx = request.workspace;
    await this.project(ctx, projectId);
    const parsed = parseCandidateRequest(body ?? {});
    if (!parsed.ok) throw new BadRequestException({ errors: { [parsed.error]: 'invalid' } });
    return this.queue(ctx, projectId, { ...parsed.request });
  }

  private async queue(
    ctx: WorkspaceRequestContext,
    projectId: string,
    r: Record<string, unknown> & { locationId: string; count: number },
  ) {
    const loc = await this.prisma.client.sceneLocation.findFirst({
      where: { id: r.locationId, projectId, workspaceId: ctx.workspaceId },
      select: { id: true, name: true, kind: true, description: true },
    });
    if (!loc) throw new BadRequestException({ errors: { locationId: 'invalid' } });
    const params = { ...r, location: loc, seeds: seedsFor(r.count) };
    return this.prisma.client.gpuJob.create({
      data: {
        workspaceId: ctx.workspaceId,
        projectId,
        kind: 'scene_candidates',
        params: params as unknown as Prisma.InputJsonValue,
      },
      select: { id: true, status: true, createdAt: true },
    });
  }

  /** More candidates like this one: the same request, new seeds. */
  @Post('scenes/:id/more')
  @WorkspaceRoles(...CONNECT_ROLES)
  async more(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { count?: unknown } | undefined,
    @Req() request: Ctx,
  ) {
    const ctx = request.workspace;
    await this.project(ctx, projectId);
    const scene = await this.prisma.client.scene.findFirst({
      where: { id, projectId, workspaceId: ctx.workspaceId },
      select: { locationId: true, job: { select: { params: true } } },
    });
    if (!scene?.job) throw new NotFoundException();
    const {
      seeds: _seeds,
      location: _location,
      ...req
    } = scene.job.params as Record<string, unknown>;
    const count = Number(body?.count ?? 4);
    return this.queue(ctx, projectId, {
      ...req,
      locationId: scene.locationId,
      count: Number.isInteger(count) && count >= 1 && count <= 8 ? count : 4,
    });
  }

  @Post('gpu-jobs/:id/cancel')
  @WorkspaceRoles(...CONNECT_ROLES)
  async cancel(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() request: Ctx,
  ) {
    const ctx = request.workspace;
    await this.project(ctx, projectId);
    const res = await this.prisma.client.gpuJob.updateMany({
      where: { id, projectId, workspaceId: ctx.workspaceId, status: 'queued' },
      data: { status: 'cancelled', finishedAt: new Date() },
    });
    if (!res.count) throw new BadRequestException({ errors: { job: 'not_queued' } });
    return { ok: true };
  }

  /** Into the library / back to candidates / archive / reject; name and tags. */
  @Patch('scenes/:id')
  @WorkspaceRoles(...CONNECT_ROLES)
  async update(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: Record<string, unknown> | undefined,
    @Req() request: Ctx,
  ) {
    const ctx = request.workspace;
    await this.project(ctx, projectId);
    const data: Prisma.SceneUpdateManyMutationInput = {};
    if (body?.['status'] !== undefined) {
      const status = typeof body['status'] === 'string' ? body['status'] : '';
      if (!(STATUSES as readonly string[]).includes(status)) {
        throw new BadRequestException({ errors: { status: 'invalid' } });
      }
      data.status = status;
      data.decidedAt = new Date();
    }
    if (body?.['name'] !== undefined) {
      data.name =
        typeof body['name'] === 'string' ? body['name'].trim().slice(0, 120) || null : null;
    }
    if (Array.isArray(body?.['tags'])) {
      data.tags = [
        ...new Set(
          body['tags'].map((t) => String(t).trim().toLowerCase().slice(0, 40)).filter(Boolean),
        ),
      ].slice(0, 20);
    }
    const res = await this.prisma.client.scene.updateMany({
      where: { id, projectId, workspaceId: ctx.workspaceId },
      data,
    });
    if (!res.count) throw new NotFoundException();
    return this.prisma.client.scene.findUniqueOrThrow({ where: { id }, select: SCENE_SELECT });
  }

  @Delete('scenes/:id')
  @WorkspaceRoles(...CONNECT_ROLES)
  async remove(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() request: Ctx,
  ) {
    const ctx = request.workspace;
    await this.project(ctx, projectId);
    const scene = await this.prisma.client.scene.findFirst({
      where: { id, projectId, workspaceId: ctx.workspaceId },
      select: { id: true, assetId: true },
    });
    if (!scene) throw new NotFoundException();
    await this.removeScenes([scene]);
    return { ok: true };
  }

  /** A library file, only to members who see the project. */
  @Get('assets/:id')
  async asset(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() request: Ctx,
    @Res() res: Response,
  ) {
    const ctx = request.workspace;
    await this.project(ctx, projectId);
    const asset = await this.prisma.client.asset.findFirst({
      where: { id, projectId, workspaceId: ctx.workspaceId },
      select: { path: true, mime: true, bytes: true, sha256: true },
    });
    const file = asset && assetFile(asset.path);
    if (!asset || !file) throw new NotFoundException();
    res.setHeader('Content-Type', asset.mime);
    res.setHeader('Content-Length', String(asset.bytes));
    res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
    res.setHeader('ETag', `"${asset.sha256.slice(0, 16)}"`);
    createReadStream(file)
      .on('error', () => res.status(404).end())
      .pipe(res);
  }
}
