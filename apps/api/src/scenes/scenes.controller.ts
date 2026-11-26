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
import { composePrompt, DEFAULT_RULES, DIRECTIONS, type Mockup } from './rules.js';
import {
  MAX_CANDIDATES,
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
  sceneType: true,
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

const LOCATION_SELECT = {
  id: true,
  name: true,
  description: true,
  mustHave: true,
  direction: true,
  coverSceneId: true,
  archivedAt: true,
  position: true,
} satisfies Prisma.SceneLocationSelect;

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const isId = (v: unknown): v is string =>
  typeof v === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

/**
 * Scenes of the Workshop (ADR-0042): locations - photoshoot places with a style - and the scenes generated in them on the
 * owner's PC; new scenes wait for the owner's decision (keep / reject / more like this). The prompt of every scene is
 * built here from the project's editable rules, so the PC only draws.
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

  private async location(ctx: WorkspaceRequestContext, projectId: string, id: string) {
    const loc = await this.prisma.client.sceneLocation.findFirst({
      where: { id, projectId, workspaceId: ctx.workspaceId },
      select: LOCATION_SELECT,
    });
    if (!loc) throw new NotFoundException();
    return loc;
  }

  private async gpu(workspaceId: string) {
    const workers = await this.prisma.client.gpuWorker.findMany({
      where: { workspaceId, revokedAt: null },
      select: { lastSeenAt: true, state: true },
    });
    return { state: bestState(workers.map((w) => workerState(w))), workers: workers.length };
  }

  /** The project's rules; the shipped defaults are copied in the first time (the owner edits them afterwards). */
  private async rules(ctx: WorkspaceRequestContext, projectId: string) {
    const db = this.prisma.client;
    const have = await db.sceneRule.findMany({ where: { projectId }, select: { key: true } });
    const missing = DEFAULT_RULES.filter((r) => !have.some((h) => h.key === r.key));
    if (missing.length) {
      await db.sceneRule.createMany({
        data: missing.map((r) => ({
          workspaceId: ctx.workspaceId,
          projectId,
          key: r.key,
          direction: r.direction,
          label: r.label,
          text: r.text,
          ...(r.mockup ? { mockup: r.mockup as unknown as Prisma.InputJsonValue } : {}),
          builtIn: true,
          position: DEFAULT_RULES.indexOf(r),
        })),
        skipDuplicates: true,
      });
    }
    return db.sceneRule.findMany({
      where: { projectId },
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
      select: { key: true, direction: true, label: true, text: true, mockup: true, builtIn: true },
    });
  }

  /** Deletes rejected scenes older than a week, with their files. */
  private async cleanUp(projectId: string) {
    const old = await this.prisma.client.scene.findMany({
      where: {
        projectId,
        status: 'rejected',
        decidedAt: { lt: new Date(Date.now() - REJECTED_KEEP_MS) },
      },
      select: { id: true, assetId: true },
    });
    if (old.length) await this.removeScenes(old);
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

  /** The list of locations: cover, counts, scene types in it; and the state of the PC. */
  @Get('scenes')
  async list(@Param('projectId', ParseUUIDPipe) projectId: string, @Req() request: Ctx) {
    const ctx = request.workspace;
    await this.project(ctx, projectId);
    await this.cleanUp(projectId);
    const db = this.prisma.client;
    const [locations, counts, firsts, rules] = await Promise.all([
      db.sceneLocation.findMany({
        where: { projectId, workspaceId: ctx.workspaceId },
        orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
        select: LOCATION_SELECT,
      }),
      db.scene.groupBy({
        by: ['locationId', 'status', 'sceneType'],
        where: { projectId, workspaceId: ctx.workspaceId },
        _count: true,
      }),
      db.scene.findMany({
        where: { projectId, workspaceId: ctx.workspaceId, status: 'library' },
        orderBy: { createdAt: 'asc' },
        select: { id: true, locationId: true, assetId: true },
      }),
      this.rules(ctx, projectId),
    ]);
    const label = new Map(rules.map((r) => [r.key, r.label]));
    return {
      locations: locations.map((l) => {
        const mine = counts.filter((c) => c.locationId === l.id);
        const sum = (status: string) =>
          mine.filter((c) => c.status === status).reduce((n, c) => n + c._count, 0);
        const types = new Map<string, number>();
        for (const c of mine.filter((c) => c.status === 'library' && c.sceneType)) {
          types.set(c.sceneType!, (types.get(c.sceneType!) ?? 0) + c._count);
        }
        const own = firsts.filter((f) => f.locationId === l.id);
        const cover = own.find((f) => f.id === l.coverSceneId) ?? own[0];
        return {
          ...l,
          coverAssetId: cover?.assetId ?? null,
          scenes: sum('library'),
          fresh: sum('candidate'),
          archived: sum('archived'),
          sceneTypes: [...types].map(([key, count]) => ({
            key,
            label: label.get(key) ?? key,
            count,
          })),
        };
      }),
      gpu: await this.gpu(ctx.workspaceId),
    };
  }

  /** One location: its scenes (new ones grouped by request on the client), jobs, scene types of its direction. */
  @Get('scene-locations/:id')
  async one(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() request: Ctx,
  ) {
    const ctx = request.workspace;
    await this.project(ctx, projectId);
    await this.cleanUp(projectId);
    const loc = await this.location(ctx, projectId, id);
    const db = this.prisma.client;
    const [scenes, jobs, rules] = await Promise.all([
      db.scene.findMany({
        where: { locationId: id, status: { not: 'rejected' } },
        orderBy: [{ createdAt: 'desc' }, { number: 'asc' }],
        take: 1000,
        select: SCENE_SELECT,
      }),
      db.gpuJob.findMany({
        where: {
          projectId,
          workspaceId: ctx.workspaceId,
          params: { path: ['locationId'], equals: id },
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
          stage: true,
          error: true,
          params: true,
          createdAt: true,
          claimedAt: true,
          finishedAt: true,
        },
      }),
      this.rules(ctx, projectId),
    ]);
    return {
      location: loc,
      scenes,
      jobs: jobs.map((j) => {
        // the prompt stays on the server side of the page: long, and only for the recipe
        const { prompt: _p, ...params } = j.params as Record<string, unknown>;
        return { ...j, params };
      }),
      sceneTypes: rules
        .filter((r) => r.key !== 'general' && r.direction === loc.direction)
        .map((r) => ({ key: r.key, label: r.label })),
      allTypes: rules
        .filter((r) => r.key !== 'general')
        .map((r) => ({ key: r.key, label: r.label })),
      gpu: await this.gpu(ctx.workspaceId),
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
    const name = str(body?.['name'], 80);
    if (!name) throw new BadRequestException({ errors: { name: 'required' } });
    const rawDirection = typeof body?.['direction'] === 'string' ? body['direction'] : '';
    const direction = (DIRECTIONS as readonly string[]).includes(rawDirection)
      ? rawDirection
      : 'interior';
    const last = await this.prisma.client.sceneLocation.aggregate({
      where: { projectId },
      _max: { position: true },
    });
    return this.prisma.client.sceneLocation.create({
      data: {
        workspaceId: ctx.workspaceId,
        projectId,
        name,
        direction,
        description: str(body?.['description'], 1000) || null,
        mustHave: str(body?.['mustHave'], 500) || null,
        position: (last._max.position ?? -1) + 1,
      },
      select: LOCATION_SELECT,
    });
  }

  /** Name, style, must-haves, direction, cover, archive, position. */
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
    await this.location(ctx, projectId, id);
    const data: Prisma.SceneLocationUpdateInput = {};
    if (body?.['name'] !== undefined) {
      const name = str(body['name'], 80);
      if (!name) throw new BadRequestException({ errors: { name: 'required' } });
      data.name = name;
    }
    if (body?.['description'] !== undefined)
      data.description = str(body['description'], 1000) || null;
    if (body?.['mustHave'] !== undefined) data.mustHave = str(body['mustHave'], 500) || null;
    if (body?.['direction'] !== undefined) {
      const d = typeof body['direction'] === 'string' ? body['direction'] : '';
      if (!(DIRECTIONS as readonly string[]).includes(d)) {
        throw new BadRequestException({ errors: { direction: 'invalid' } });
      }
      data.direction = d;
    }
    if (body?.['coverSceneId'] !== undefined) {
      const cover = body['coverSceneId'];
      if (cover !== null && !isId(cover)) {
        throw new BadRequestException({ errors: { coverSceneId: 'invalid' } });
      }
      if (cover) {
        const own = await this.prisma.client.scene.count({ where: { id: cover, locationId: id } });
        if (!own) throw new BadRequestException({ errors: { coverSceneId: 'invalid' } });
      }
      data.coverSceneId = cover;
    }
    if (typeof body?.['archived'] === 'boolean')
      data.archivedAt = body['archived'] ? new Date() : null;
    if (typeof body?.['position'] === 'number') data.position = Math.round(body['position']);
    return this.prisma.client.sceneLocation.update({
      where: { id },
      data,
      select: LOCATION_SELECT,
    });
  }

  /** A location can be deleted only without kept scenes (new and rejected ones go with it). */
  @Delete('scene-locations/:id')
  @WorkspaceRoles(...CONNECT_ROLES)
  async deleteLocation(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() request: Ctx,
  ) {
    const ctx = request.workspace;
    await this.project(ctx, projectId);
    await this.location(ctx, projectId, id);
    const db = this.prisma.client;
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

  /** "Add scenes": the prompt is built from the rules here; the job carries it and the mock-up for the PC. */
  @Post('scene-locations/:id/generate')
  @WorkspaceRoles(...CONNECT_ROLES)
  async generate(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: Record<string, unknown> | undefined,
    @Req() request: Ctx,
  ) {
    const ctx = request.workspace;
    await this.project(ctx, projectId);
    const parsed = parseCandidateRequest({ ...body, locationId: id });
    if (!parsed.ok) throw new BadRequestException({ errors: { [parsed.error]: 'invalid' } });
    return this.queue(ctx, projectId, { ...parsed.request });
  }

  private async queue(
    ctx: WorkspaceRequestContext,
    projectId: string,
    r: Record<string, unknown> & {
      locationId: string;
      sceneType: string;
      count: number;
      sizeClass: string;
      light: string;
      style: string;
      notes: string;
    },
  ) {
    const loc = await this.location(ctx, projectId, r.locationId);
    const rules = await this.rules(ctx, projectId);
    const typeRule = rules.find((x) => x.key === r.sceneType && x.key !== 'general');
    const general = rules.find((x) => x.key === 'general');
    if (!typeRule || !general) throw new BadRequestException({ errors: { sceneType: 'invalid' } });
    const prompt = composePrompt({
      location: loc,
      typeRule,
      general,
      sizeClass: r.sizeClass,
      light: r.light,
      style: r.style,
      notes: r.notes,
    });
    const params = {
      ...r,
      location: { id: loc.id, name: loc.name, direction: loc.direction },
      sceneTypeLabel: typeRule.label,
      mockup: (typeRule.mockup as Mockup | null) ?? null,
      prompt,
      seeds: seedsFor(r.count),
    };
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

  /** More like this one: the same request with today's rules, new seeds. */
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
      select: { locationId: true, sceneType: true, job: { select: { params: true } } },
    });
    if (!scene?.job) throw new NotFoundException();
    const p = scene.job.params as Record<string, unknown>;
    const parsed = parseCandidateRequest({
      ...p,
      sceneType: p['sceneType'] ?? scene.sceneType ?? 'living',
      locationId: scene.locationId,
      count: body?.count ?? 4,
    });
    if (!parsed.ok) throw new BadRequestException({ errors: { [parsed.error]: 'invalid' } });
    return this.queue(ctx, projectId, { ...parsed.request });
  }

  /**
   * "Refine": the PC edits this very scene by the owner's instruction (remove the floor lamp, darker walls), keeping the
   * camera, layout and the free floor; the results come back as new scenes of the same location.
   */
  @Post('scenes/:id/refine')
  @WorkspaceRoles(...CONNECT_ROLES)
  async refine(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { instruction?: unknown; count?: unknown } | undefined,
    @Req() request: Ctx,
  ) {
    const ctx = request.workspace;
    await this.project(ctx, projectId);
    const instruction = str(body?.instruction, 500);
    if (!instruction) throw new BadRequestException({ errors: { instruction: 'required' } });
    const count = Number(body?.count ?? 2);
    const scene = await this.prisma.client.scene.findFirst({
      where: { id, projectId, workspaceId: ctx.workspaceId },
      select: SCENE_SELECT,
    });
    if (!scene?.assetId) throw new NotFoundException();
    const n = Number.isInteger(count) && count >= 1 && count <= 4 ? count : 2;
    const prompt =
      `Edit the photograph in image 1: ${instruction}. ` +
      'Change only that. Keep everything else exactly as it is: the same camera and framing, the same room, ' +
      'furniture, materials, colours and light, and the open bare floor area in front stays empty. ' +
      'The result is a real, unedited-looking photograph.';
    const params = {
      locationId: scene.locationId,
      sceneType: scene.sceneType,
      light: scene.light,
      angle: scene.angle,
      sizeClass: scene.sizeClass,
      placement: scene.placement,
      productTypes: scene.productTypes,
      style: scene.style ?? '',
      count: n,
      seeds: seedsFor(n),
      instruction,
      parentSceneId: scene.id,
      parentNumber: scene.number,
      sourceAssetId: scene.assetId,
      // the mock-up of the original, for placing a product later
      proxy: (scene.params as { proxy?: unknown }).proxy ?? null,
      prompt,
    };
    return this.prisma.client.gpuJob.create({
      data: {
        workspaceId: ctx.workspaceId,
        projectId,
        kind: 'scene_refine',
        params: params as unknown as Prisma.InputJsonValue,
      },
      select: { id: true, status: true, createdAt: true },
    });
  }

  /** Several decisions at once ("keep the chosen ones, reject the rest"). */
  @Post('scenes/decide')
  @WorkspaceRoles(...CONNECT_ROLES)
  async decide(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() body: { keep?: unknown; reject?: unknown } | undefined,
    @Req() request: Ctx,
  ) {
    const ctx = request.workspace;
    await this.project(ctx, projectId);
    const ids = (v: unknown) =>
      Array.isArray(v) ? v.filter(isId).slice(0, MAX_CANDIDATES * 50) : [];
    const where = { projectId, workspaceId: ctx.workspaceId };
    const now = new Date();
    const [kept, rejected] = await Promise.all([
      this.prisma.client.scene.updateMany({
        where: { ...where, id: { in: ids(body?.keep) } },
        data: { status: 'library', decidedAt: now },
      }),
      this.prisma.client.scene.updateMany({
        where: { ...where, id: { in: ids(body?.reject) }, status: 'candidate' },
        data: { status: 'rejected', decidedAt: now },
      }),
    ]);
    return { kept: kept.count, rejected: rejected.count };
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

  /** Keep / reject / archive / back; name and tags. */
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
    if (body?.['name'] !== undefined) data.name = str(body['name'], 120) || null;
    if (Array.isArray(body?.['tags'])) {
      data.tags = [
        ...new Set(
          body['tags']
            .map((t) => (typeof t === 'string' ? t.trim().toLowerCase().slice(0, 40) : ''))
            .filter(Boolean),
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

  /** The rules the prompt is built from: general, and one per scene type with its mock-up. */
  @Get('scene-rules')
  async listRules(@Param('projectId', ParseUUIDPipe) projectId: string, @Req() request: Ctx) {
    await this.project(request.workspace, projectId);
    return { rules: await this.rules(request.workspace, projectId) };
  }

  @Patch('scene-rules/:key')
  @WorkspaceRoles(...CONNECT_ROLES)
  async updateRule(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('key') key: string,
    @Body() body: Record<string, unknown> | undefined,
    @Req() request: Ctx,
  ) {
    await this.project(request.workspace, projectId);
    await this.rules(request.workspace, projectId);
    const data: Prisma.SceneRuleUpdateInput = {};
    if (body?.['label'] !== undefined) {
      const label = str(body['label'], 60);
      if (!label) throw new BadRequestException({ errors: { label: 'required' } });
      data.label = label;
    }
    if (body?.['text'] !== undefined) {
      const text = str(body['text'], 4000);
      if (!text) throw new BadRequestException({ errors: { text: 'required' } });
      data.text = text;
    }
    const res = await this.prisma.client.sceneRule.updateMany({
      where: { projectId, workspaceId: request.workspace.workspaceId, key },
      data: data as Prisma.SceneRuleUpdateManyMutationInput,
    });
    if (!res.count) throw new NotFoundException();
    return { ok: true };
  }

  /** The shipped text back (for a built-in rule). */
  @Post('scene-rules/:key/reset')
  @WorkspaceRoles(...CONNECT_ROLES)
  async resetRule(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('key') key: string,
    @Req() request: Ctx,
  ) {
    await this.project(request.workspace, projectId);
    const shipped = DEFAULT_RULES.find((r) => r.key === key);
    if (!shipped) throw new NotFoundException();
    await this.prisma.client.sceneRule.updateMany({
      where: { projectId, workspaceId: request.workspace.workspaceId, key },
      data: { label: shipped.label, text: shipped.text },
    });
    return { ok: true };
  }

  /** A new scene type of the owner's, starting from an existing one's mock-up (e.g. "Terrace" from the living room). */
  @Post('scene-rules')
  @WorkspaceRoles(...CONNECT_ROLES)
  async createRule(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() body: Record<string, unknown> | undefined,
    @Req() request: Ctx,
  ) {
    const ctx = request.workspace;
    await this.project(ctx, projectId);
    const rules = await this.rules(ctx, projectId);
    const label = str(body?.['label'], 60);
    const text = str(body?.['text'], 4000);
    if (!label) throw new BadRequestException({ errors: { label: 'required' } });
    if (!text) throw new BadRequestException({ errors: { text: 'required' } });
    const base = rules.find((r) => r.key === body?.['basedOn'] && r.key !== 'general');
    if (!base) throw new BadRequestException({ errors: { basedOn: 'invalid' } });
    let key = `custom_${Date.now().toString(36)}`;
    while (rules.some((r) => r.key === key)) key += 'x';
    const last = rules.length;
    return this.prisma.client.sceneRule.create({
      data: {
        workspaceId: ctx.workspaceId,
        projectId,
        key,
        direction: base.direction,
        label,
        text,
        ...(base.mockup ? { mockup: base.mockup as Prisma.InputJsonValue } : {}),
        position: last,
      },
      select: { key: true, direction: true, label: true, text: true, mockup: true, builtIn: true },
    });
  }

  /** The owner's own scene type can be deleted while no scene uses it. */
  @Delete('scene-rules/:key')
  @WorkspaceRoles(...CONNECT_ROLES)
  async deleteRule(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('key') key: string,
    @Req() request: Ctx,
  ) {
    await this.project(request.workspace, projectId);
    const db = this.prisma.client;
    const rule = await db.sceneRule.findFirst({
      where: { projectId, workspaceId: request.workspace.workspaceId, key },
      select: { id: true, builtIn: true },
    });
    if (!rule) throw new NotFoundException();
    if (rule.builtIn) throw new BadRequestException({ errors: { key: 'built_in' } });
    if (await db.scene.count({ where: { projectId, sceneType: key } })) {
      throw new BadRequestException({ errors: { key: 'in_use' } });
    }
    await db.sceneRule.delete({ where: { id: rule.id } });
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
