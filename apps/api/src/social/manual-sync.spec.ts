import { describe, expect, it } from 'vitest';
import { MANUAL_SYNC_COOLDOWN_MS, nextManualSync } from './manual-sync.js';

describe('nextManualSync', () => {
  const now = new Date('2026-11-07T12:00:00Z');

  it('is available for an account that never synced', () => {
    expect(nextManualSync(null, now)).toBeNull();
  });

  it('waits for the cooldown after the last attempt', () => {
    const last = new Date(now.getTime() - 4 * 60 * 1000);
    expect(nextManualSync(last, now)).toEqual(new Date(last.getTime() + MANUAL_SYNC_COOLDOWN_MS));
  });

  it('is available once the cooldown has passed', () => {
    expect(nextManualSync(new Date(now.getTime() - MANUAL_SYNC_COOLDOWN_MS), now)).toBeNull();
  });
});
