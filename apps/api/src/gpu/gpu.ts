import { createHash, randomBytes } from 'node:crypto';

/** GPU worker (ADR-0041): its key, shown once like a password; only the hash is stored. */
const BASE62 = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
export const newWorkerKey = () =>
  `gpw_${Array.from(randomBytes(32), (b) => BASE62[b % BASE62.length]).join('')}`;
export const hashWorkerKey = (key: string) => createHash('sha256').update(key).digest('hex');
export const isWorkerKey = (key: string) => /^gpw_[A-Za-z0-9]{32}$/.test(key);

/** A heartbeat older than this means the PC is off or the agent is not running. */
export const HEARTBEAT_FRESH_MS = 90_000;

export type GpuState = 'ready' | 'busy' | 'offline';

/** 🟢 ready = fresh heartbeat and the agent says it may work; 🟡 busy = fresh but not now; ⚪ offline. */
export function workerState(
  w: { lastSeenAt: Date | null; state: string | null; revokedAt?: Date | null },
  now = Date.now(),
): GpuState {
  if (w.revokedAt || !w.lastSeenAt || now - w.lastSeenAt.getTime() > HEARTBEAT_FRESH_MS)
    return 'offline';
  return w.state === 'ready' ? 'ready' : 'busy';
}

/** The best state among a workspace's workers. */
export function bestState(states: GpuState[]): GpuState {
  return states.includes('ready') ? 'ready' : states.includes('busy') ? 'busy' : 'offline';
}

/** A running job whose worker went silent this long is put back in the queue. */
export const STALE_RUNNING_MS = 15 * 60_000;
