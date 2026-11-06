/**
 * Queue names and job payloads shared by producers (api) and consumers (worker).
 * Every job that touches workspace data must carry workspaceId (tenant context),
 * and the worker must re-check that referenced resources belong to it.
 */
export const QUEUES = {
  system: 'system',
  sync: 'sync',
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

export const SYSTEM_JOBS = {
  heartbeat: 'heartbeat',
} as const;

export interface HeartbeatJob {
  requestedAt: string;
}

export const SYNC_JOBS = {
  /** Repeatable: finds accounts that are due and enqueues `account` jobs. */
  tick: 'tick',
  /** Synchronizes one social account. */
  account: 'account',
} as const;

export type SyncKind = 'INITIAL' | 'DAILY' | 'MANUAL' | 'RETRY';

export interface SyncAccountJob {
  workspaceId: string;
  accountId: string;
  kind: SyncKind;
}

/** One queued or running sync per account: BullMQ ignores an add with an existing job id. */
export function syncJobId(accountId: string): string {
  return `sync-${accountId}`;
}
