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
import { Session, type UserSession } from '@thallesp/nestjs-better-auth';
import type { Request, Response } from 'express';
import { Prisma } from '@adelie/db';
import { assetFile, MIME_EXT, readBinary, saveAsset } from '../assets/storage.js';
import { improveRefineRequest } from './refine-request.js';
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
  composePrompt,
  composeSketchPrompt,
  DEFAULT_RULES,
  DIRECTIONS,
  type Mockup,
} from './rules.js';
import {
  MAX_CANDIDATES,
  parseCandidateRequest,
  REJECTED_KEEP_MS,
  seedsFor,
  STATUSES,
} from './scenes.js';

type Ctx = { workspace: WorkspaceRequestContext };

/** References one request may carry (the model takes up to 10 images; the mock-up is image 1). */
const MAX_REFS = 3;

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

const SKETCH_SELECT = {
  id: true,
  assetId: true,
  sceneType: true,
  name: true,
  zone: true,
  position: true,
} satisfies Prisma.SceneSketchSelect;

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
    const [scenes, jobs, rules, sketches] = await Promise.all([
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
          dismissedAt: null,
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
      db.sceneSketch.findMany({
        where: { locationId: id },
        orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
        select: SKETCH_SELECT,
      }),
    ]);
    return {
      location: loc,
      scenes,
      sketches,
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
    const refs = await this.references(projectId, body?.['referenceIds']);
    let sketchId: string | null = null;
    if (body?.['sketchId'] !== undefined && body['sketchId'] !== null) {
      if (!isId(body['sketchId']))
        throw new BadRequestException({ errors: { sketchId: 'invalid' } });
      const sk = await this.prisma.client.sceneSketch.findFirst({
        where: { id: body['sketchId'], locationId: id },
        select: { id: true, sceneType: true },
      });
      if (!sk) throw new BadRequestException({ errors: { sketchId: 'invalid' } });
      sketchId = sk.id;
      parsed.request.sceneType = sk.sceneType;
    }
    return this.queue(ctx, projectId, { ...parsed.request, refAssetIds: refs, sketchId });
  }

  /** The owner's sketch of a room: the image as the body; scene type and name in the query. */
  @Post('scene-locations/:id/sketches')
  @WorkspaceRoles(...CONNECT_ROLES)
  async uploadSketch(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('sceneType') sceneType: string | undefined,
    @Query('name') name: string | undefined,
    @Req() request: Ctx & Request,
  ) {
    const ctx = request.workspace;
    await this.project(ctx, projectId);
    await this.location(ctx, projectId, id);
    const rules = await this.rules(ctx, projectId);
    const type = rules.find((r) => r.key === sceneType && r.key !== 'general');
    if (!type) throw new BadRequestException({ errors: { sceneType: 'invalid' } });
    const mime = String(request.headers['content-type'] ?? '')
      .split(';')[0]!
      .trim();
    if (!MIME_EXT[mime]) throw new BadRequestException({ errors: { file: 'type' } });
    const data = await readBinary(request, 20 * 1024 * 1024);
    if (!data?.length) throw new BadRequestException({ errors: { file: 'size' } });
    const asset = await saveAsset(this.prisma.client, {
      workspaceId: ctx.workspaceId,
      projectId,
      role: 'scene_sketch',
      origin: 'upload',
      mime,
      data,
      recipe: { locationId: id },
    });
    const last = await this.prisma.client.sceneSketch.aggregate({
      where: { locationId: id },
      _max: { position: true },
    });
    return this.prisma.client.sceneSketch.create({
      data: {
        workspaceId: ctx.workspaceId,
        projectId,
        locationId: id,
        assetId: asset.id,
        sceneType: type.key,
        name: str(name, 80) || null,
        position: (last._max.position ?? -1) + 1,
      },
      select: SKETCH_SELECT,
    });
  }

  @Patch('scene-sketches/:id')
  @WorkspaceRoles(...CONNECT_ROLES)
  async updateSketch(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: Record<string, unknown> | undefined,
    @Req() request: Ctx,
  ) {
    const ctx = request.workspace;
    await this.project(ctx, projectId);
    const data: Prisma.SceneSketchUpdateManyMutationInput = {};
    if (body?.['sceneType'] !== undefined) {
      const rules = await this.rules(ctx, projectId);
      const key = typeof body['sceneType'] === 'string' ? body['sceneType'] : '';
      if (!rules.some((r) => r.key === key && r.key !== 'general')) {
        throw new BadRequestException({ errors: { sceneType: 'invalid' } });
      }
      data.sceneType = key;
    }
    if (body?.['name'] !== undefined) data.name = str(body['name'], 80) || null;
    const res = await this.prisma.client.sceneSketch.updateMany({
      where: { id, projectId, workspaceId: ctx.workspaceId },
      data,
    });
    if (!res.count) throw new NotFoundException();
    return { ok: true };
  }

  @Delete('scene-sketches/:id')
  @WorkspaceRoles(...CONNECT_ROLES)
  async deleteSketch(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() request: Ctx,
  ) {
    const ctx = request.workspace;
    await this.project(ctx, projectId);
    const sk = await this.prisma.client.sceneSketch.findFirst({
      where: { id, projectId, workspaceId: ctx.workspaceId },
      select: { id: true },
    });
    if (!sk) throw new NotFoundException();
    // the file stays: scenes made from it keep their recipe
    await this.prisma.client.sceneSketch.delete({ where: { id } });
    return { ok: true };
  }

  /** Reference images of a request: the project's uploaded references, at most MAX_REFS, in the given order. */
  private async references(projectId: string, raw: unknown): Promise<string[]> {
    const ids = (Array.isArray(raw) ? raw : []).filter(isId).slice(0, MAX_REFS);
    if (!ids.length) return [];
    const found = await this.prisma.client.asset.findMany({
      where: { id: { in: ids }, projectId, role: 'scene_reference' },
      select: { id: true },
    });
    if (found.length !== ids.length)
      throw new BadRequestException({ errors: { references: 'invalid' } });
    return ids;
  }

  /**
   * A reference for "Add scenes" (an interior, a material, a mood): the image as the body (image/jpeg, png or webp),
   * stored in the project's library; the request then names it.
   */
  @Post('scene-locations/:id/references')
  @WorkspaceRoles(...CONNECT_ROLES)
  async upload(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() request: Ctx & Request,
  ) {
    const ctx = request.workspace;
    await this.project(ctx, projectId);
    await this.location(ctx, projectId, id);
    const mime = String(request.headers['content-type'] ?? '')
      .split(';')[0]!
      .trim();
    if (!MIME_EXT[mime]) throw new BadRequestException({ errors: { file: 'type' } });
    const data = await readBinary(request, 15 * 1024 * 1024);
    if (!data?.length) throw new BadRequestException({ errors: { file: 'size' } });
    const asset = await saveAsset(this.prisma.client, {
      workspaceId: ctx.workspaceId,
      projectId,
      role: 'scene_reference',
      origin: 'upload',
      mime,
      data,
      recipe: { locationId: id },
    });
    return { id: asset.id };
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
    const sketch = r['sketchId']
      ? await this.prisma.client.sceneSketch.findFirst({
          where: { id: r['sketchId'] as string, locationId: r.locationId },
          select: { id: true, assetId: true },
        })
      : null;
    const prompt = sketch
      ? composeSketchPrompt({
          location: loc,
          typeLabel: typeRule.label,
          general,
          sizeClass: r.sizeClass,
          light: r.light,
          style: r.style,
          notes: r.notes,
        })
      : composePrompt({
          location: loc,
          typeRule,
          general,
          sizeClass: r.sizeClass,
          light: r.light,
          style: r.style,
          notes: r.notes,
        });
    const refs = (r['refAssetIds'] as string[] | undefined) ?? [];
    // References described before (by the PC, kept on the file) go as words at once; the PC describes the rest.
    const described = refs.length
      ? await this.prisma.client.asset.findMany({
          where: { id: { in: refs } },
          select: { id: true, recipe: true },
        })
      : [];
    const refDescriptions = refs.map(
      (id) =>
        ((described.find((d) => d.id === id)?.recipe as { description?: string } | null)
          ?.description as string | undefined) ?? null,
    );
    const params = {
      ...r,
      refAssetIds: refs,
      refDescriptions,
      location: { id: loc.id, name: loc.name, direction: loc.direction },
      sceneTypeLabel: typeRule.label,
      mockup: (typeRule.mockup as Mockup | null) ?? null,
      sketchId: sketch?.id ?? null,
      // the agent downloads the sketch as the job's source image
      sourceAssetId: sketch?.assetId ?? null,
      // a short description for the photographic second pass (RealVisXL)
      photoPrompt: [
        `a real photograph of a ${typeRule.label} interior`,
        loc.description?.trim().slice(0, 220),
        r.light === 'evening' ? 'evening, warm lamp light' : 'warm natural daylight',
        'shot on a full-frame camera, natural textures, subtle film grain',
      ]
        .filter(Boolean)
        .join(', '),
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
    const refs = Array.isArray(p['refAssetIds']) ? (p['refAssetIds'] as string[]) : [];
    const sketchId = typeof p['sketchId'] === 'string' ? p['sketchId'] : null;
    return this.queue(ctx, projectId, { ...parsed.request, refAssetIds: refs, sketchId });
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
    @Session() session: UserSession,
    @Req() request: Ctx,
  ) {
    const ctx = request.workspace;
    await this.project(ctx, projectId);
    const instruction = str(body?.instruction, 500);
    if (!instruction) throw new BadRequestException({ errors: { instruction: 'required' } });
    return this.queueRefine(ctx, session.user.id, projectId, id, instruction, body?.count, null);
  }

  /**
   * "Refine an area" (owner, 2026-11-27): the owner paints over a part of the scene and says what to do there. The
   * mask comes as the body (PNG, white = change), the instruction and count in the query. The PC shows the model the
   * scene with the area tinted red, the model edits the whole frame, and only the area (with what grew from it) is
   * pasted back over the original with a soft seam.
   */
  @Post('scenes/:id/refine-area')
  @WorkspaceRoles(...CONNECT_ROLES)
  async refineArea(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('instruction') rawInstruction: string | undefined,
    @Query('count') count: string | undefined,
    @Session() session: UserSession,
    @Req() request: Ctx & Request,
  ) {
    const ctx = request.workspace;
    await this.project(ctx, projectId);
    const instruction = str(rawInstruction, 500);
    if (!instruction) throw new BadRequestException({ errors: { instruction: 'required' } });
    const mime = String(request.headers['content-type'] ?? '')
      .split(';')[0]!
      .trim();
    if (mime !== 'image/png') throw new BadRequestException({ errors: { mask: 'type' } });
    const data = await readBinary(request, 10 * 1024 * 1024);
    if (!data?.length) throw new BadRequestException({ errors: { mask: 'size' } });
    const scene = await this.prisma.client.scene.findFirst({
      where: { id, projectId, workspaceId: ctx.workspaceId },
      select: { id: true },
    });
    if (!scene) throw new NotFoundException();
    const mask = await saveAsset(this.prisma.client, {
      workspaceId: ctx.workspaceId,
      projectId,
      role: 'scene_mask',
      origin: 'upload',
      mime,
      data,
      recipe: { sceneId: id },
    });
    return this.queueRefine(ctx, session.user.id, projectId, id, instruction, count, mask.id);
  }

  private async queueRefine(
    ctx: Ctx['workspace'],
    userId: string,
    projectId: string,
    id: string,
    instruction: string,
    rawCount: unknown,
    maskAssetId: string | null,
  ) {
    const count = Number(rawCount ?? 2);
    const scene = await this.prisma.client.scene.findFirst({
      where: { id, projectId, workspaceId: ctx.workspaceId },
      select: SCENE_SELECT,
    });
    if (!scene?.assetId) throw new NotFoundException();
    const n = Number.isInteger(count) && count >= 1 && count <= 4 ? count : 2;
    // The owner's words, in any language, become one concrete English instruction (the model ignored Ukrainian
    // requests in tests, 2026-11-27); without AI the owner's words go as they are.
    const [rules, loc] = await Promise.all([
      this.rules(ctx, projectId),
      this.location(ctx, projectId, scene.locationId),
    ]);
    const english = await improveRefineRequest(this.prisma.client, {
      workspaceId: ctx.workspaceId,
      projectId,
      userId,
      request: instruction,
      area: !!maskAssetId,
      sceneType: rules.find((r) => r.key === scene.sceneType)?.label ?? scene.sceneType,
      location: loc.description,
    });
    const what = english ?? `"${instruction}"`;
    const prompt = maskAssetId
      ? // the PC tints the area red on the scene it shows the model, then pastes only the area back
        'Image 1 is a photograph with one area tinted semi-transparent red. Edit only that red-tinted area: ' +
        `${what}. Remove the red tint completely. Everything else stays as it is: the same camera, room, ` +
        'furniture and light; everything at its true real-world size with natural contact shadows. The result is ' +
        'a real, unedited-looking photograph.'
      : `Edit the photograph in image 1: ${what}. ` +
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
      instructionEn: english,
      parentSceneId: scene.id,
      parentNumber: scene.number,
      sourceAssetId: scene.assetId,
      // "Refine an area": the owner's mask (white = change); the agent downloads it from /gpu/jobs/:id/mask
      maskAssetId,
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

  /** The owner closes a failed job's message on the location page. */
  @Post('gpu-jobs/:id/dismiss')
  @WorkspaceRoles(...CONNECT_ROLES)
  async dismiss(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() request: Ctx,
  ) {
    const ctx = request.workspace;
    await this.project(ctx, projectId);
    const res = await this.prisma.client.gpuJob.updateMany({
      where: { id, projectId, workspaceId: ctx.workspaceId, status: 'failed' },
      data: { dismissedAt: new Date() },
    });
    if (!res.count) throw new NotFoundException();
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
