import { describe, expect, it } from 'vitest';
import {
  etsyMarket,
  keywordPool,
  marketsFromOrders,
  mentions,
  parseMarkets,
  phraseKey,
  pinterestRegions,
  rankProducts,
  readTrends,
  relevantTrends,
  suggestProducts,
  trendFilters,
} from './research.js';

describe('markets', () => {
  it('come from the orders’ countries', () => {
    const orders = [
      ...Array(72).fill('US'),
      ...Array(17).fill('AU'),
      ...Array(6).fill('NO'),
      'LV',
      null,
    ];
    expect(marketsFromOrders(orders)).toEqual([
      { code: 'US', share: 75 },
      { code: 'AU', share: 18 },
      { code: 'NO', share: 6 },
    ]);
    expect(marketsFromOrders([])).toEqual([{ code: 'US', share: 100 }]);
  });

  it('map to Pinterest regions by weight', () => {
    expect(
      pinterestRegions([
        { code: 'US', share: 70 },
        { code: 'AU', share: 15 },
        { code: 'NO', share: 6 },
        { code: 'SE', share: 6 },
        { code: 'DE', share: 3 },
      ]),
    ).toEqual([
      { region: 'US', weight: 70 },
      { region: 'AU+NZ', weight: 15 },
      { region: 'SE+DK+FI+NO', weight: 12 },
    ]);
  });

  it('from the client must be codes and shares', () => {
    expect(parseMarkets([{ code: 'us', share: 70.4 }])).toEqual([{ code: 'US', share: 70 }]);
    expect(parseMarkets([{ code: 'USA', share: 1 }])).toBeNull();
    expect(parseMarkets([])).toBeNull();
  });
});

describe('text', () => {
  it('folds plurals and case', () => {
    expect(phraseKey('Wool Pillows')).toBe('wool pillow');
    expect(mentions('Shaggy Wool Pillow Cover 18x18', 'wool pillows')).toBe(true);
    expect(mentions('Wool rug', 'wool pillow')).toBe(false);
    expect(phraseKey('Christmas Pillows')).toBe('christmas pillow');
    expect(phraseKey('cozy bedrooms canvas')).toBe('cozy bedroom canvas');
  });

  it('trends filter by the specific word and keep what the niche shares', () => {
    expect(trendFilters(['wool pillow', 'shaggy pillow cover', 'wool rug'])).toEqual([
      'pillow',
      'rug',
    ]);
    const t = (keyword: string) => ({
      keyword,
      region: 'US',
      wow: null,
      mom: null,
      yoy: null,
      peak: null,
      recent: [],
    });
    expect(
      relevantTrends(
        [t('christmas pillows on couch'), t('christmas highlight cover'), t('shaggy rug')],
        ['wool pillow', 'shaggy pillow cover'],
      ).map((x) => x.keyword),
    ).toEqual(['christmas pillows on couch', 'shaggy rug']);
  });
});

describe('the Etsy market', () => {
  it('counts tags, title phrases and USD prices — nothing of the listings kept', () => {
    const l = (title: string, tags: string[], amount: number, currency = 'USD', fav = 10) => ({
      title,
      tags,
      price: { amount, divisor: 100, currency_code: currency },
      num_favorers: fav,
    });
    const m = etsyMarket('wool pillow', 5000, [
      l('Wool Pillow Cover Boho', ['wool pillow', 'boho decor'], 5000),
      l('Shaggy Wool Pillow Cover', ['wool pillow', 'shaggy pillow'], 7000),
      l('Wool pillow cover handmade', ['Wool Pillow', 'gift for her'], 9000, 'EUR'),
    ]);
    expect(m.count).toBe(5000);
    expect(m.priceUsd).toEqual({ min: 50, median: 60, max: 70, listings: 2 });
    expect(m.tags[0]).toEqual({ tag: 'wool pillow', n: 3 });
    expect(m.titlePhrases).toEqual(
      expect.arrayContaining([
        { phrase: 'pillow cover', n: 3 },
        { phrase: 'wool pillow', n: 3 },
      ]),
    );
    expect(JSON.stringify(m)).not.toContain('Shaggy Wool Pillow Cover');
  });
});

describe('Pinterest trends', () => {
  it('reads growth, the peak week and recent values', () => {
    const [t] = readTrends('US', {
      trends: [
        {
          keyword: 'Christmas Pillow',
          pct_growth_wow: 12,
          pct_growth_mom: 80,
          pct_growth_yoy: 5,
          time_series: { '2025-12-08': 100, '2025-11-10': 60, '2026-11-09': 70 },
        },
      ],
    });
    expect(t).toEqual({
      keyword: 'christmas pillow',
      region: 'US',
      wow: 12,
      mom: 80,
      yoy: 5,
      peak: '2025-12-08',
      recent: [60, 100, 70],
    });
    expect(readTrends('US', null)).toEqual([]);
  });
});

describe('pool and ranking', () => {
  const trends = readTrends('US', {
    trends: [{ keyword: 'wool pillows', pct_growth_mom: 50, time_series: {} }],
  });
  const market = etsyMarket('wool pillow', 100, [
    ...Array(5).fill({
      title: 'Boho wool pillow cover',
      tags: ['boho pillow', 'wool pillow'],
      price: null,
      num_favorers: 1,
    }),
  ]);
  const pool = keywordPool(trends, [market], ['Shaggy Wool Pillow 18x18']);

  it('merges sources by phrase and scores them', () => {
    const wool = pool.find((p) => p.phrase === 'wool pillow')!;
    expect(wool.pinterest).toMatchObject({ mom: 50, regions: ['US'] });
    expect(wool.etsy).toBe(10);
    expect(wool.own).toBe(1);
    expect(pool[0]!.phrase).toBe('wool pillow');
    expect(pool.some((p) => p.phrase === 'boho pillow')).toBe(true);
  });

  it('ranks sellers with niche words first and says why', () => {
    const ranked = rankProducts(
      [
        { id: 'a', title: 'Rug', tags: [], views: 10, favorers: 1, sold12m: 0 },
        {
          id: 'b',
          title: 'Shaggy Wool Pillow 18x18',
          tags: ['wool pillow'],
          views: 300,
          favorers: 40,
          sold12m: 7,
        },
      ],
      pool,
    );
    expect(ranked[0]).toMatchObject({ id: 'b', matched: expect.arrayContaining(['wool pillow']) });
    expect(ranked[0]!.reasons).toEqual(
      expect.arrayContaining(['sells', 'liked', 'viewed', 'trending', 'fewTags', 'shortTitle']),
    );
    expect(ranked[1]!.reasons).toContain('noTags');
    expect(ranked[0]!.missing).toContain('boho pillow');
  });

  it('suggests catalogue products of the niche', () => {
    const catalogue = [
      { title: 'Shaggy wool pillow', tags: [], category: null },
      { title: 'Carpathian rug', tags: [], category: 'Rugs' },
      { title: 'Cushion', tags: ['wool pillow'], category: null },
    ];
    expect(suggestProducts(catalogue, ['wool pillow']).map((p) => p.title)).toEqual([
      'Shaggy wool pillow',
      'Cushion',
    ]);
  });
});
