import { describe, expect, it } from 'vitest';
import { hitScore, parseHitSettings, rankHits, type HitCandidate } from './hits.js';

const cand = (
  key: string,
  signals: Partial<HitCandidate['signals']>,
  coverage: Partial<HitCandidate['coverage']> = {},
): HitCandidate => ({
  key,
  productId: key,
  title: key,
  url: null,
  signals: { purchases: 0, checkouts: 0, views: 0, ...signals },
  coverage: { pins90: 0, lastPin: null, pinTitles: [], inCalendar: [], ...coverage },
});

describe('hits', () => {
  it('weighs a purchase over a started checkout over a view', () => {
    expect(hitScore({ purchases: 1, checkouts: 0, views: 0 })).toBe(10);
    expect(hitScore({ purchases: 0, checkouts: 1, views: 0 })).toBe(3);
    expect(hitScore({ purchases: 0, checkouts: 0, views: 1 })).toBe(1);
    expect(hitScore({ purchases: 1, checkouts: 2, views: 5 })).toBe(21);
  });

  it('ranks by score; products without any signal drop out', () => {
    const r = rankHits(
      [cand('a', { views: 5 }), cand('b', { purchases: 1 }), cand('c', {})],
      '2026-11-24',
    );
    expect(r.map((h) => h.key)).toEqual(['b', 'a']);
  });

  it('a product that got many pins is less appealing than one that got none', () => {
    const r = rankHits(
      [
        cand('worn', { purchases: 2 }, { pins90: 3, lastPin: '2026-09-01' }),
        cand('fresh', { purchases: 1 }),
      ],
      '2026-11-24',
    );
    expect(r.map((h) => h.key)).toEqual(['fresh', 'worn']);
    expect(r[1]!.priority).toBe(5);
  });

  it('a recent pin or a planned item puts a product to rest, after the ready ones', () => {
    const r = rankHits(
      [
        cand('pinned', { purchases: 9 }, { pins90: 1, lastPin: '2026-11-20' }),
        cand('planned', { purchases: 8 }, { inCalendar: ['a pin'] }),
        cand('ok', { views: 3 }),
        cand('oldpin', { views: 2 }, { pins90: 1, lastPin: '2026-11-10' }),
      ],
      '2026-11-24',
    );
    expect(r.map((h) => [h.key, h.status, h.reason])).toEqual([
      ['ok', 'ready', null],
      ['oldpin', 'ready', null],
      ['pinned', 'cooling', 'recent_pin'],
      ['planned', 'cooling', 'in_calendar'],
    ]);
    expect(r.find((h) => h.key === 'oldpin')!.daysSincePin).toBe(14);
  });

  it('settings: valid account ids, days within limits, none = no settings', () => {
    const id = '0190a0b0-1111-7222-8333-444455556666';
    expect(parseHitSettings({ accountIds: [id, id, 'x'], days: 500 })).toEqual({
      accountIds: [id],
      days: 90,
    });
    expect(parseHitSettings({ accountIds: [id] })).toEqual({ accountIds: [id], days: 30 });
    expect(parseHitSettings({ accountIds: [] })).toBeNull();
    expect(parseHitSettings(null)).toBeNull();
  });
});
