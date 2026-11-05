import { existsSync } from 'node:fs';
import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { QUEUES, SYSTEM_JOBS, type HeartbeatJob } from '@adelie/shared';

const rootEnv = new URL('../../../.env', import.meta.url);
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const redisUrl = process.env['REDIS_URL'];
if (!redisUrl) throw new Error('Missing required environment variable: REDIS_URL');

// BullMQ requires maxRetriesPerRequest: null for blocking worker connections.
const connection = new Redis(redisUrl, { maxRetriesPerRequest: null });

const systemQueue = new Queue<HeartbeatJob>(QUEUES.system, { connection });

const systemWorker = new Worker<HeartbeatJob>(
  QUEUES.system,
  async (job) => {
    if (job.name === SYSTEM_JOBS.heartbeat) {
      console.log(`[worker] heartbeat ${job.id} requested at ${job.data.requestedAt}`);
      return { ok: true };
    }
    throw new Error(`Unknown job: ${job.name}`);
  },
  { connection },
);

systemWorker.on('failed', (job, err) => {
  console.error(`[worker] job ${job?.name}#${job?.id} failed: ${err.message}`);
});

// Smoke test: proves the queue → worker path works on startup.
await systemQueue.add(SYSTEM_JOBS.heartbeat, { requestedAt: new Date().toISOString() });
console.log('[worker] started');

async function shutdown() {
  await systemWorker.close();
  await systemQueue.close();
  connection.disconnect();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
