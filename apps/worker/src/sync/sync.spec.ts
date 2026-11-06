import { describe, expect, it } from 'vitest';
import {
  dailyFetchWindow,
  dimensionKey,
  latestRow,
  snapshotChanged,
  worstStatus,
} from './metrics.js';
import { analyticsRange, dueSync } from './schedule.js';

const at = (iso: string) => new Date(iso);
const active = { connectionStatus: 'ACTIVE' as const };

describe('dueSync', () => {
  it('INITIAL right after connecting', () => {
    expect(
      dueSync(
        { ...active, lastSyncedAt: null, lastSuccessfulSyncAt: null },
        at('2026-11-06T10:00Z'),
      ),
    ).toBe('INITIAL');
  });

  it('retries a failed INITIAL after an hour, not before', () => {
    const failed = { ...active, lastSyncedAt: at('2026-11-06T10:00Z'), lastSuccessfulSyncAt: null };
    expect(dueSync(failed, at('2026-11-06T10:30Z'))).toBeNull();
    expect(dueSync(failed, at('2026-11-06T11:01Z'))).toBe('INITIAL');
  });

  it('DAILY once per UTC day, after 04:00 UTC', () => {
    const synced = {
      ...active,
      lastSyncedAt: at('2026-11-06T10:00Z'),
      lastSuccessfulSyncAt: at('2026-11-06T10:00Z'),
    };
    expect(dueSync(synced, at('2026-11-06T23:00Z'))).toBeNull();
    expect(dueSync(synced, at('2026-11-07T03:59Z'))).toBeNull();
    expect(dueSync(synced, at('2026-11-07T04:00Z'))).toBe('DAILY');
  });

  it('never for connections that need reauthorization', () => {
    expect(
      dueSync(
        {
          connectionStatus: 'REAUTHORIZATION_REQUIRED',
          lastSyncedAt: null,
          lastSuccessfulSyncAt: null,
        },
        at('2026-11-06T10:00Z'),
      ),
    ).toBeNull();
  });
});

describe('analyticsRange', () => {
  it('INITIAL takes the full window counting today, DAILY a week', () => {
    expect(analyticsRange('INITIAL', at('2026-11-06T10:00Z'), 90)).toEqual({
      from: '2026-08-09',
      to: '2026-11-06',
    });
    expect(analyticsRange('DAILY', at('2026-11-06T10:00Z'), 90)).toEqual({
      from: '2026-10-31',
      to: '2026-11-06',
    });
  });
});

describe('metric helpers', () => {
  it('dimension keys are canonical', () => {
    expect(dimensionKey()).toBe('');
    expect(dimensionKey({ b: '2', a: '1' })).toBe('a=1&b=2');
  });

  it('snapshots change on value or status, not otherwise', () => {
    const p = { value: 5, dataStatus: 'READY' as const };
    expect(snapshotChanged(undefined, p)).toBe(true);
    expect(snapshotChanged(p, p)).toBe(false);
    expect(snapshotChanged(p, { ...p, value: 6 })).toBe(true);
    expect(snapshotChanged(p, { ...p, dataStatus: 'ESTIMATE' })).toBe(true);
    expect(
      snapshotChanged(
        { value: null, dataStatus: 'UNAVAILABLE' },
        { value: 0, dataStatus: 'READY' },
      ),
    ).toBe(true);
  });

  it('worst status wins', () => {
    expect(worstStatus(['READY', 'ESTIMATE', 'PROCESSING'])).toBe('ESTIMATE');
    expect(worstStatus([])).toBe('READY');
  });

  it('builds the wide latest row; unknown keys ignored, null stays null', () => {
    expect(
      latestRow([
        { key: 'impressions', value: 50.4, dataStatus: 'READY', date: '2026-11-05' },
        { key: 'saves', value: null, dataStatus: 'UNAVAILABLE', date: '2026-11-06' },
        { key: 'something_new', value: 1, dataStatus: 'READY', date: '2026-11-06' },
      ]),
    ).toEqual({
      impressions: 50,
      saves: null,
      pinClicks: null,
      outboundClicks: null,
      engagements: null,
      videoViews: null,
      engagementRate: null,
      dataStatus: 'UNAVAILABLE',
      asOfDate: '2026-11-06',
    });
    expect(latestRow([])).toBeNull();
  });
});

describe('dailyFetchWindow', () => {
  const base = { today: '2026-11-06', historyDays: 90, changed: false, pending: false };

  it('first time: from publication, clamped to the platform history', () => {
    expect(dailyFetchWindow({ publishedAt: '2026-10-10', dailyTo: null }, base)).toEqual({
      from: '2026-10-10',
      to: '2026-11-06',
    });
    expect(dailyFetchWindow({ publishedAt: '2025-01-01', dailyTo: null }, base)).toEqual({
      from: '2026-08-09',
      to: '2026-11-06',
    });
  });

  it('no activity and final days: nothing to fetch', () => {
    expect(dailyFetchWindow({ publishedAt: null, dailyTo: '2026-11-05' }, base)).toBeNull();
  });

  it('changed or pending: the last week, covering any gap', () => {
    const w = { publishedAt: null, dailyTo: '2026-11-05' };
    expect(dailyFetchWindow(w, { ...base, changed: true })).toEqual({
      from: '2026-10-30',
      to: '2026-11-06',
    });
    expect(dailyFetchWindow(w, { ...base, pending: true })?.from).toBe('2026-10-30');
    expect(
      dailyFetchWindow({ publishedAt: null, dailyTo: '2026-10-01' }, { ...base, changed: true }),
    ).toEqual({ from: '2026-09-25', to: '2026-11-06' });
  });
});
