/**
 * Queue names and job payloads shared by producers (api) and consumers (worker).
 * Every job that touches workspace data must carry workspaceId (tenant context),
 * and the worker must re-check that referenced resources belong to it.
 */
export const QUEUES = {
  system: 'system',
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

export const SYSTEM_JOBS = {
  heartbeat: 'heartbeat',
} as const;

export interface HeartbeatJob {
  requestedAt: string;
}
