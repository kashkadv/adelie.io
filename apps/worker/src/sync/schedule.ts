// When is an account due for synchronization (stage-2 plan, ADR-0011). Pure — unit-tested.
import type { SyncKind } from '@adelie/shared';

/** Daily syncs start after this UTC hour: Pinterest has settled most of yesterday by then. */
export const DAILY_HOUR_UTC = 4;
/** After a failed attempt, wait this long before the next one. */
export const RETRY_AFTER_MS = 60 * 60 * 1000;

export interface AccountSyncState {
  connectionStatus: 'ACTIVE' | 'REAUTHORIZATION_REQUIRED' | 'REVOKED';
  /** Last attempt (any outcome). */
  lastSyncedAt: Date | null;
  /** Last SUCCESS or PARTIAL. */
  lastSuccessfulSyncAt: Date | null;
}

const utcDay = (d: Date) => d.toISOString().slice(0, 10);

/** Which sync an account needs now, or null. */
export function dueSync(account: AccountSyncState, now: Date): SyncKind | null {
  if (account.connectionStatus !== 'ACTIVE') return null;
  const recentlyTried =
    account.lastSyncedAt !== null &&
    now.getTime() - account.lastSyncedAt.getTime() < RETRY_AFTER_MS;

  // Never synced successfully: right away (just connected), or retry after a failure.
  if (!account.lastSuccessfulSyncAt) return recentlyTried ? null : 'INITIAL';

  // Already synced today (UTC).
  if (utcDay(account.lastSuccessfulSyncAt) === utcDay(now)) return null;
  if (now.getUTCHours() < DAILY_HOUR_UTC || recentlyTried) return null;
  return 'DAILY';
}

/** Analytics window for a sync: the platform's full history on INITIAL, a week otherwise. */
export function analyticsRange(
  kind: SyncKind,
  now: Date,
  historyDays: number,
): { from: string; to: string } {
  const days = kind === 'INITIAL' ? historyDays : 7;
  const from = new Date(now);
  // The platform counts today as day 1 of its window ("last 90 days").
  from.setUTCDate(from.getUTCDate() - (days - 1));
  return { from: utcDay(from), to: utcDay(now) };
}
