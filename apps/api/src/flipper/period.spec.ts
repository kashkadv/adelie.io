import { describe, expect, it } from 'vitest';
import { periodOf, startOfToday } from './period.js';

describe('startOfToday', () => {
  it('is local midnight in the time zone, as a UTC moment', () => {
    // 2026-11-10 12:00 UTC: Kyiv is UTC+2 in November, so its day began at 2026-11-09 22:00 UTC.
    expect(startOfToday('Europe/Kyiv', new Date('2026-11-10T12:00:00Z')).toISOString()).toBe(
      '2026-11-09T22:00:00.000Z',
    );
    // 23:30 UTC is already the next day in Kyiv.
    expect(startOfToday('Europe/Kyiv', new Date('2026-11-09T23:30:00Z')).toISOString()).toBe(
      '2026-11-09T22:00:00.000Z',
    );
    expect(startOfToday('UTC', new Date('2026-11-10T12:00:00Z')).toISOString()).toBe(
      '2026-11-10T00:00:00.000Z',
    );
  });

  it('falls back to UTC for an unknown zone', () => {
    expect(startOfToday('Nowhere/Land', new Date('2026-11-10T12:00:00Z')).toISOString()).toBe(
      '2026-11-10T00:00:00.000Z',
    );
  });
});

describe('periodOf', () => {
  const now = new Date('2026-11-10T12:00:00Z');
  it('knows today and the three ranges, and defaults to 7 days', () => {
    expect(periodOf('today', 'UTC', now)).toEqual({
      n: 1,
      since: new Date('2026-11-10T00:00:00Z'),
    });
    expect(periodOf('30', 'UTC', now).n).toBe(30);
    expect(periodOf('x', 'UTC', now).n).toBe(7);
    expect(periodOf(undefined, 'UTC', now).since.toISOString()).toBe('2026-11-03T12:00:00.000Z');
  });
});
