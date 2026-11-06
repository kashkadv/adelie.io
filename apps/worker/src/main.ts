import { existsSync } from 'node:fs';
import { createPrismaClient } from '@adelie/db';
import { PINTEREST_API, PinterestAdapter } from '@adelie/platforms';
import {
  QUEUES,
  SYNC_JOBS,
  SYSTEM_JOBS,
  syncJobId,
  type HeartbeatJob,
  type SyncAccountJob,
} from '@adelie/shared';
import { tokenCipherFromEnv } from '@adelie/shared/crypto';
import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { purgeOldPayloads, runSync, type SyncDeps } from './sync/run-sync.js';
import { dueSync } from './sync/schedule.js';

const rootEnv = new URL('../../../.env', import.meta.url);
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

// BullMQ requires maxRetriesPerRequest: null for blocking worker connections.
const connection = new Redis(required('REDIS_URL'), { maxRetriesPerRequest: null });
const prisma = createPrismaClient(required('DATABASE_URL'));
const cipher = tokenCipherFromEnv();

const pinterest =
  process.env['PINTEREST_APP_ID'] && process.env['PINTEREST_APP_SECRET']
    ? new PinterestAdapter({
        appId: process.env['PINTEREST_APP_ID'],
        appSecret: process.env['PINTEREST_APP_SECRET'],
      })
    : null;

const deps: SyncDeps = {
  prisma,
  cipher,
  adapterFor: (platform) =>
    platform === 'PINTEREST' && pinterest ? { adapter: pinterest, baseUrl: PINTEREST_API } : null,
  log: (message) => console.log(`[sync] ${message}`),
};

// ---------- System queue (smoke test) ----------
const systemQueue = new Queue<HeartbeatJob>(QUEUES.system, { connection });
const systemWorker = new Worker<HeartbeatJob>(
  QUEUES.system,
  async (job) => {
    if (job.name === SYSTEM_JOBS.heartbeat) return { ok: true };
    throw new Error(`Unknown job: ${job.name}`);
  },
  { connection },
);

// ---------- Sync queue ----------
const syncQueue = new Queue<SyncAccountJob | Record<string, never>>(QUEUES.sync, { connection });
let lastPurgeDay = '';

/** Enqueues a sync for every account that is due; one job per account (job id dedupes). */
async function tick(): Promise<number> {
  const now = new Date();
  const accounts = await prisma.socialAccount.findMany({
    select: {
      id: true,
      workspaceId: true,
      lastSyncedAt: true,
      lastSuccessfulSyncAt: true,
      connection: { select: { status: true } },
    },
  });
  let queued = 0;
  for (const a of accounts) {
    const kind = dueSync({ connectionStatus: a.connection.status, ...a }, now);
    if (!kind) continue;
    await syncQueue.add(
      SYNC_JOBS.account,
      { workspaceId: a.workspaceId, accountId: a.id, kind },
      { jobId: syncJobId(a.id), removeOnComplete: true, removeOnFail: true },
    );
    queued++;
  }
  const today = now.toISOString().slice(0, 10);
  if (today !== lastPurgeDay) {
    lastPurgeDay = today;
    const purged = await purgeOldPayloads(prisma, now);
    if (purged) console.log(`[sync] purged ${purged} raw payloads older than 90 days`);
  }
  return queued;
}

const syncWorker = new Worker<SyncAccountJob | Record<string, never>>(
  QUEUES.sync,
  async (job) => {
    if (job.name === SYNC_JOBS.tick) return { queued: await tick() };
    if (job.name === SYNC_JOBS.account) return runSync(deps, job.data as SyncAccountJob);
    throw new Error(`Unknown job: ${job.name}`);
  },
  // Several accounts in parallel; one account never twice (job id). Platform limits are per
  // app+user, and each run has its own rate-limit tracking.
  { connection, concurrency: 3 },
);

for (const w of [systemWorker, syncWorker]) {
  w.on('failed', (job, err) =>
    console.error(`[worker] job ${job?.name}#${job?.id} failed: ${err.message}`),
  );
}

// The scheduler: a repeatable tick every minute (BullMQ keeps a single schedule across restarts).
await syncQueue.upsertJobScheduler(
  'sync-tick',
  { every: 60_000 },
  { name: SYNC_JOBS.tick, data: {} },
);
await systemQueue.add(SYSTEM_JOBS.heartbeat, { requestedAt: new Date().toISOString() });
console.log('[worker] started');

async function shutdown() {
  await Promise.all([systemWorker.close(), syncWorker.close()]);
  await Promise.all([systemQueue.close(), syncQueue.close()]);
  await prisma.$disconnect();
  connection.disconnect();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
