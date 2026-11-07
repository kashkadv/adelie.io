/** Minimum gap between a sync attempt and a manual one (platform limits, ADR-0011). */
export const MANUAL_SYNC_COOLDOWN_MS = 10 * 60 * 1000;

/** When "Sync now" becomes available again, or null if it is available now. */
export function nextManualSync(lastSyncedAt: Date | null, now: Date): Date | null {
  if (!lastSyncedAt) return null;
  const next = new Date(lastSyncedAt.getTime() + MANUAL_SYNC_COOLDOWN_MS);
  return next > now ? next : null;
}
