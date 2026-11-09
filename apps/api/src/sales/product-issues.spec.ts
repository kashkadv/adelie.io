import { describe, expect, it } from 'vitest';
import { productIssues, type IssueProduct } from './product-issues.js';

const NOW = new Date('2026-11-09T12:00:00Z');
const product = (over: Partial<IssueProduct> = {}): IssueProduct => ({
  id: 'p1',
  state: 'active',
  price: 4500,
  quantity: 3,
  views: 120,
  imageUrl: 'https://img/x.jpg',
  tags: Array.from({ length: 13 }, (_, i) => `tag${i}`),
  skus: ['00031307'],
  variationCount: 1,
  skuBy: [],
  skuGroups: 1,
  listedAt: new Date('2026-01-01T00:00:00Z'),
  posts: 2,
  ...over,
});
const codes = (list: IssueProduct[], id = 'p1') =>
  (productIssues(list, NOW).get(id) ?? []).map((i) => `${i.level}:${i.code}`);

describe('productIssues', () => {
  it('a healthy product has none', () => {
    expect(codes([product()])).toEqual([]);
  });

  it('critical: a pin leads to a product that is not on sale', () => {
    expect(codes([product({ state: 'expired', posts: 1 })])).toEqual(['critical:pinToUnavailable']);
    expect(codes([product({ state: 'removed', posts: 0 })])).toEqual([]);
  });

  it('critical: no price, no photo, active with nothing in stock', () => {
    expect(codes([product({ price: null, imageUrl: null, quantity: 0 })])).toEqual([
      'critical:noPrice',
      'critical:noPhoto',
      'critical:soldOutActive',
    ]);
  });

  it('only active products are judged for their own data', () => {
    expect(codes([product({ state: 'inactive', skus: [], tags: [], posts: 0 })])).toEqual([]);
  });

  it('SKU: missing, shared by several listings, one for all variations', () => {
    expect(codes([product({ skus: [] })])).toEqual(['important:noSku']);
    const dup = [product({ id: 'a' }), product({ id: 'b' })];
    expect(codes(dup, 'a')).toEqual(['critical:duplicateSku']);
    expect(codes(dup, 'b')).toEqual(['critical:duplicateSku']);
    // several variations, the SKU goes by none of their options: one SKU for all
    expect(codes([product({ variationCount: 4 })])).toEqual(['important:sharedSku']);
    // SKU by colour, every colour has its own: fine however many sizes there are
    expect(
      codes([
        product({ variationCount: 8, skuBy: ['Color'], skuGroups: 2, skus: ['J-BLK', 'J-BLU'] }),
      ]),
    ).toEqual([]);
    // a single colour with several sizes: one SKU is right
    expect(
      codes([product({ variationCount: 4, skuBy: ['Color'], skuGroups: 1, skus: ['J-BLK'] })]),
    ).toEqual([]);
    // 4 sizes with a SKU each wanted, only 3 filled or distinct
    const gap = productIssues(
      [product({ variationCount: 4, skuBy: ['Size'], skuGroups: 4, skus: ['R-1', 'R-2', 'R-3'] })],
      NOW,
    ).get('p1');
    expect(gap).toEqual([
      { code: 'skuGaps', level: 'important', params: { have: 3, groups: 4, by: 'Size' } },
    ]);
    // variations not read yet: nothing to say
    expect(codes([product({ variationCount: null })])).toEqual([]);
    // a SKU repeated on an inactive listing is not ambiguous for sales
    expect(codes([product({ id: 'a' }), product({ id: 'b', state: 'inactive' })], 'a')).toEqual([]);
  });

  it('important: no tags, no pins — with or without sales', () => {
    expect(codes([product({ tags: [], posts: 0 })])).toEqual([
      'important:noTags',
      'important:noPins',
    ]);
  });

  it('notes: few tags, no views for a month, a SKU that lost its zeros', () => {
    expect(codes([product({ tags: ['a', 'b'] })])).toEqual(['note:fewTags']);
    expect(codes([product({ views: 0 })])).toEqual(['note:noViews']);
    expect(codes([product({ views: 0, listedAt: new Date('2026-11-01T00:00:00Z') })])).toEqual([]);
    const shop = [
      product({ id: 'a', skus: ['00031307'] }),
      product({ id: 'b', skus: ['00031308'] }),
      product({ id: 'c', skus: ['31309'] }),
    ];
    expect(codes(shop, 'c')).toEqual(['note:skuFormat']);
    expect(codes(shop, 'a')).toEqual([]);
    // no zero-padding convention in the shop: nothing to flag
    expect(
      codes([product({ id: 'a', skus: ['31309'] }), product({ id: 'b', skus: ['41'] })], 'a'),
    ).toEqual([]);
  });
});
