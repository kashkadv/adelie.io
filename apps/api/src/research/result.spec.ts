import { describe, expect, it } from 'vitest';
import { researchResult, type DailyPoint } from './result.js';

/** A counter growing by `before` a day until `at`, then by `after`. */
function series(
  from: string,
  days: number,
  at: string,
  before: number,
  after: number,
): DailyPoint[] {
  const out: DailyPoint[] = [];
  let views = 100;
  let favorers = 10;
  for (let i = 0; i < days; i++) {
    const date = new Date(Date.parse(`${from}T00:00:00Z`) + i * 86_400_000)
      .toISOString()
      .slice(0, 10);
    out.push({ date, views, favorers });
    const rate = date < at ? before : after;
    views += rate;
    favorers += rate / 2;
  }
  return out;
}

describe('research result', () => {
  const today = '2026-11-30';
  const changed = {
    id: 'a',
    daily: series('2026-11-08', 23, '2026-11-13', 2, 6),
    changes: [
      { date: '2026-11-13', fields: ['tags', 'title'] },
      { date: '2026-11-15', fields: ['description'] },
    ],
    sales: [
      { date: '2026-11-10', quantity: 1 },
      { date: '2026-11-20', quantity: 2 },
    ],
  };
  const unchanged = {
    id: 'b',
    daily: series('2026-11-08', 23, '2026-11-13', 2, 3),
    changes: [],
    sales: [],
  };

  it('compares before and after the first change, against the unchanged over the same days', () => {
    const r = researchResult([changed, unchanged], today);
    expect(r.since).toBe('2026-11-13');
    expect(r.daysBefore).toBe(5);
    expect(r.daysAfter).toBe(17);
    expect(r.enough).toBe(true);
    expect(r.products[0]).toMatchObject({
      changedOn: '2026-11-13',
      fields: ['description', 'tags', 'title'],
    });
    expect(r.changed.before).toEqual({ viewsPerDay: 2, favorersPerDay: 1, sales: 1 });
    expect(r.changed.after).toMatchObject({ viewsPerDay: 6, sales: 2 });
    expect(r.changed.viewsChange).toBe(200);
    expect(r.unchanged.viewsChange).toBe(50);
  });

  it('says when there are not enough days yet', () => {
    const r = researchResult([changed, unchanged], '2026-11-15');
    expect(r.daysAfter).toBe(2);
    expect(r.enough).toBe(false);
  });

  it('nothing changed: no comparison', () => {
    const r = researchResult([unchanged], today);
    expect(r.since).toBeNull();
    expect(r.changed.products).toBe(0);
    expect(r.products[0]!.before).toBeNull();
  });
});
