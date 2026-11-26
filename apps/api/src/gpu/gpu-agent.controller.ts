import { Controller, Param, ParseUUIDPipe, Post, Req, Res } from '@nestjs/common';
import { AllowAnonymous } from '@thallesp/nestjs-better-auth';
import type { Request, Response } from 'express';
import { Prisma } from '@adelie/db';
import { MIME_EXT, readBinary, saveAsset } from '../assets/storage.js';
import { PrismaService } from '../prisma.service.js';
import { SIZE_CLASSES, type SizeClass } from '../scenes/scenes.js';
import { hashWorkerKey, isWorkerKey, STALE_RUNNING_MS } from './gpu.js';

const MAX_IMAGE_BYTES = 40 * 1024 * 1024;

/**
 * The agent on the owner's PC (ADR-0041): it calls these routes, Adelie never calls the PC. Authenticated by the
 * worker key (`Authorization: Bearer gpw_…`). Heartbeat → claim a job → upload results → done / failed.
 */
@Controller('gpu')
@AllowAnonymous()
export class GpuAgentController {
  constructor(private readonly prisma: PrismaService) {}

  private async worker(req: Request) {
    const header = String(req.headers.authorization ?? '');
    const key = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    if (!isWorkerKey(key)) return null;
    return this.prisma.client.gpuWorker.findFirst({
      where: { keyHash: hashWorkerKey(key), revokedAt: null },
      select: { id: true, workspaceId: true },
    });
  }

  /** The PC is alive: its state (ready / busy) and free VRAM; 'offline' when the agent stops. */
  @Post('heartbeat')
  async heartbeat(@Req() req: Request, @Res() res: Response) {
    const w = await this.worker(req);
    if (!w) return res.status(401).json({ error: 'unauthorized' });
    const body = (req.body ?? {}) as { state?: unknown; vramFreeMb?: unknown; info?: unknown };
    await this.prisma.client.gpuWorker.update({
      where: { id: w.id },
      data: {
        // 'offline': the agent is shutting down - the PC shows offline at once, not after the 90 s timeout
        lastSeenAt: body.state === 'offline' ? null : new Date(),
        state: body.state === 'ready' ? 'ready' : body.state === 'offline' ? 'offline' : 'busy',
        vramFreeMb: typeof body.vramFreeMb === 'number' ? Math.round(body.vramFreeMb) : null,
        ...(body.info && typeof body.info === 'object'
          ? { info: body.info as Prisma.InputJsonValue }
          : {}),
      },
    });
    return res.json({ ok: true });
  }

  /**
   * Takes the oldest queued job of the worker's workspace (atomically, so two agents never take the same one). A
   * running job whose worker went silent goes back to the queue first.
   */
  @Post('claim')
  async claim(@Req() req: Request, @Res() res: Response) {
    const w = await this.worker(req);
    if (!w) return res.status(401).json({ error: 'unauthorized' });
    const db = this.prisma.client;
    await db.gpuJob.updateMany({
      where: {
        workspaceId: w.workspaceId,
        status: 'running',
        updatedAt: { lt: new Date(Date.now() - STALE_RUNNING_MS) },
      },
      data: { status: 'queued', workerId: null, progress: 0 },
    });
    const [row] = await db.$queryRaw<{ id: string }[]>`
      UPDATE gpu_job SET status = 'running', "workerId" = ${w.id}::uuid, "claimedAt" = now(), "updatedAt" = now()
      WHERE id = (
        SELECT id FROM gpu_job WHERE "workspaceId" = ${w.workspaceId}::uuid AND status = 'queued'
        ORDER BY "createdAt" LIMIT 1 FOR UPDATE SKIP LOCKED
      ) RETURNING id`;
    if (!row) return res.status(204).end();
    const job = await db.gpuJob.findUniqueOrThrow({
      where: { id: row.id },
      select: { id: true, kind: true, params: true, projectId: true },
    });
    return res.json(job);
  }

  private async ownJob(req: Request, id: string) {
    const w = await this.worker(req);
    if (!w) return null;
    return this.prisma.client.gpuJob.findFirst({
      where: { id, workerId: w.id, status: 'running' },
      select: { id: true, workspaceId: true, projectId: true, kind: true, params: true },
    });
  }

  @Post('jobs/:id/progress')
  async progress(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const job = await this.ownJob(req, id);
    if (!job) return res.status(404).json({ error: 'job' });
    const p = Number((req.body as { progress?: unknown })?.progress);
    await this.prisma.client.gpuJob.update({
      where: { id },
      data: { progress: Number.isFinite(p) ? Math.max(0, Math.min(100, Math.round(p))) : 0 },
    });
    return res.json({ ok: true });
  }

  /**
   * One generated scene candidate: the image as the body (image/png or image/jpeg), its number and recipe in
   * headers (`X-Number`, `X-Meta` = base64 JSON: prompt, seed, model, camera and mock-up).
   */
  @Post('jobs/:id/scenes')
  async scene(@Param('id', ParseUUIDPipe) id: string, @Req() req: Request, @Res() res: Response) {
    const job = await this.ownJob(req, id);
    if (!job || job.kind !== 'scene_candidates') return res.status(404).json({ error: 'job' });
    const mime = String(req.headers['content-type'] ?? '')
      .split(';')[0]!
      .trim();
    if (!MIME_EXT[mime]) return res.status(415).json({ error: 'type' });
    const data = await readBinary(req, MAX_IMAGE_BYTES);
    if (!data) return res.status(413).json({ error: 'too_large' });
    let meta: Record<string, unknown> = {};
    try {
      meta = JSON.parse(
        Buffer.from(String(req.headers['x-meta'] ?? ''), 'base64').toString('utf8') || '{}',
      );
    } catch {
      return res.status(400).json({ error: 'meta' });
    }
    const number = Number(req.headers['x-number'] ?? 1);
    const p = job.params as Record<string, unknown>;
    const db = this.prisma.client;
    const asset = await saveAsset(db, {
      workspaceId: job.workspaceId,
      projectId: job.projectId,
      role: 'scene',
      origin: 'generated',
      mime,
      data,
      recipe: meta,
    });
    const size = SIZE_CLASSES[p['sizeClass'] as SizeClass];
    const scene = await db.scene.create({
      data: {
        workspaceId: job.workspaceId,
        projectId: job.projectId,
        locationId: String(p['locationId']),
        number: Number.isInteger(number) ? number : 1,
        room: (p['room'] as string) ?? null,
        style: (p['style'] as string) || null,
        light: (p['light'] as string) ?? null,
        angle: (p['angle'] as string) ?? null,
        sizeClass: (p['sizeClass'] as string) ?? null,
        placement: (p['placement'] as string) ?? 'floor',
        productTypes: (p['productTypes'] as string[]) ?? [],
        minCm: size?.minCm ?? null,
        maxCm: size?.maxCm ?? null,
        params: meta as Prisma.InputJsonValue,
        assetId: asset.id,
        jobId: job.id,
      },
      select: { id: true },
    });
    return res.json({ sceneId: scene.id, assetId: asset.id });
  }

  @Post('jobs/:id/done')
  async done(@Param('id', ParseUUIDPipe) id: string, @Req() req: Request, @Res() res: Response) {
    const job = await this.ownJob(req, id);
    if (!job) return res.status(404).json({ error: 'job' });
    await this.prisma.client.gpuJob.update({
      where: { id },
      data: { status: 'done', progress: 100, finishedAt: new Date() },
    });
    return res.json({ ok: true });
  }

  @Post('jobs/:id/fail')
  async fail(@Param('id', ParseUUIDPipe) id: string, @Req() req: Request, @Res() res: Response) {
    const job = await this.ownJob(req, id);
    if (!job) return res.status(404).json({ error: 'job' });
    const raw = (req.body as { error?: unknown })?.error;
    const error = (typeof raw === 'string' && raw ? raw : 'failed').slice(0, 2000);
    await this.prisma.client.gpuJob.update({
      where: { id },
      data: { status: 'failed', error, finishedAt: new Date() },
    });
    return res.json({ ok: true });
  }
}
