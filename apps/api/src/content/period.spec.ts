import { describe, expect, it } from 'vitest';
import { periodMetrics, sortByPeriod, type PeriodPost } from './period.js';

const post = (p: Partial<PeriodPost> & { id: string }): PeriodPost => ({
  publishedAt: '2026-01-01',
  dailyFrom: '2026-08-09',
  dailyTo: '2026-11-06',
  ...p,
});

describe('periodMetrics', () => {
  it('missing days inside coverage are zero; never-fetched posts have no data', () => {
    const r = periodMetrics(
      [post({ id: 'a' }), post({ id: 'b' }), post({ id: 'c', dailyFrom: null, dailyTo: null })],
      new Map([['a', { impressions: 12, saves: 1 }]]),
      '2026-10-31',
    );
    expect(r.get('a')).toEqual({
      metrics: { impressions: 12, saves: 1, pinClicks: 0, outboundClicks: 0 },
      partial: false,
    });
    expect(r.get('b')?.metrics?.impressions).toBe(0);
    expect(r.get('c')).toEqual({ metrics: null, partial: false });
  });

  it('partial when the period reaches before the data of an older post', () => {
    const r = periodMetrics(
      [
        post({ id: 'old' }),
        post({ id: 'new', publishedAt: '2026-09-01', dailyFrom: '2026-09-01' }),
      ],
      new Map(),
      '2025-11-07',
    );
    expect(r.get('old')?.partial).toBe(true);
    expect(r.get('new')?.partial).toBe(false);
  });
});

describe('sortByPeriod', () => {
  it('metric desc, no data last, then newest', () => {
    const posts = [
      post({ id: 'none', dailyFrom: null, dailyTo: null }),
      post({ id: 'low' }),
      post({ id: 'high' }),
      post({ id: 'low-new', publishedAt: '2026-05-01' }),
    ];
    const values = periodMetrics(
      posts,
      new Map([
        ['low', { impressions: 1 }],
        ['high', { impressions: 9 }],
        ['low-new', { impressions: 1 }],
      ]),
      '2026-10-31',
    );
    expect(sortByPeriod(posts, values, 'impressions').map((p) => p.id)).toEqual([
      'high',
      'low-new',
      'low',
      'none',
    ]);
  });
});
