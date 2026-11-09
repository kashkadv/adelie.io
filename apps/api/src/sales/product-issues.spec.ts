import { describe, expect, it } from 'vitest';
import { baseSku, productIssues, type IssueProduct } from './product-issues.js';

const NOW = new Date('2026-11-09T12:00:00Z');
const product = (over: Partial<IssueProduct> = {}): IssueProduct => ({
  id: 'p1',
  title: 'Wool vest',
  twinGroupId: null,
  state: 'active',
  price: 4500,
  quantity: 3,
  views: 120,
  imageUrl: 'https://img/x.jpg',
  tags: Array.from({ length: 13 }, (_, i) => `tag${i}`),
  skus: ['00031307'],
  variationCount: 1,
  skuBy: [],
  variationOptions: [],
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
    // the SKU does not vary: one SKU for the whole product is exactly what was chosen
    expect(codes([product({ variationCount: 8 })])).toEqual([]);
    // two options (colour and size) but one SKU for all: most likely a mistake
    expect(
      productIssues(
        [product({ variationCount: 8, variationOptions: ['Primary color', 'Size'] })],
        NOW,
      ).get('p1'),
    ).toEqual([
      { code: 'skuOneForAll', level: 'important', params: { options: 'Primary color, Size' } },
    ]);
    // one option (sizes) with one SKU is a legitimate way to keep a product
    expect(codes([product({ variationCount: 5, variationOptions: ['Size'] })])).toEqual([]);
    // SKU by colour, every colour has its own: fine however many sizes there are
    expect(
      codes([
        product({
          variationCount: 8,
          variationOptions: ['Color', 'Size'],
          skuBy: ['Color'],
          skuGroups: 2,
          skus: ['0040621', '0040622'],
        }),
      ]),
    ).toEqual([]);
    // a single colour with several sizes: one SKU is right
    expect(
      codes([product({ variationCount: 4, skuBy: ['Color'], skuGroups: 1, skus: ['0040621'] })]),
    ).toEqual([]);
    // 4 sizes with a SKU each wanted, only 3 filled or distinct
    const gap = productIssues(
      [
        product({
          variationCount: 4,
          skuBy: ['Size'],
          skuGroups: 4,
          skus: ['0050001', '0050002', '0050003'],
        }),
      ],
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

  it('important: a SKU that is not a numeric code looks wrong', () => {
    expect(codes([product({ skus: ['0040622'] })])).toEqual([]);
    const odd = productIssues([product({ skus: ['1896 AP_18/02/2021'] })], NOW).get('p1');
    expect(odd).toEqual([
      { code: 'skuPattern', level: 'important', params: { skus: '1896 AP_18/02/2021' } },
    ]);
  });

  it('"/n" marks one more variation of the same article: valid, and the article is what counts', () => {
    expect(baseSku('00011512/1')).toBe('00011512');
    expect(baseSku('00011512')).toBe('00011512');
    // valid, not flagged
    expect(codes([product({ skus: ['00011512', '00011512/1'], variationCount: 2 })])).toEqual([]);
    // the same article in two listings is a duplicate, whatever the suffix
    const two = [
      product({ id: 'a', skus: ['00011512'] }),
      product({ id: 'b', skus: ['00011512/1'] }),
    ];
    expect(codes(two, 'a')).toEqual(['critical:duplicateSku']);
    expect(codes(two, 'b')).toEqual(['critical:duplicateSku']);
    // a suffix that is not a number is not valid
    expect(codes([product({ skus: ['00011512/a'] })])).toEqual(['important:skuPattern']);
  });

  it('twins: not duplicates of each other, but they must agree', () => {
    const twin = (id: string, over: Partial<IssueProduct> = {}) =>
      product({ id, title: `Vest ${id}`, twinGroupId: 'g1', skus: ['0001', '0001/1'], ...over });
    // the same SKUs in two listings of one group: fine
    expect(codes([twin('a'), twin('b')], 'a')).toEqual([]);
    // the same SKUs in listings that are not twins: a duplicate
    expect(
      codes([twin('a', { twinGroupId: null }), twin('b', { twinGroupId: null })], 'a'),
    ).toEqual(['critical:duplicateSku']);
    // a twin whose SKUs or price differ: both are told
    const apart = [twin('a'), twin('b', { skus: ['0001'] })];
    expect(productIssues(apart, NOW).get('a')).toEqual([
      { code: 'twinMismatch', level: 'important', params: { twin: 'Vest b' } },
    ]);
    expect(codes(apart, 'b')).toEqual(['important:twinMismatch']);
    expect(codes([twin('a'), twin('b', { price: 1000 })], 'a')).toEqual(['important:twinMismatch']);
    // an inactive twin is not compared
    expect(codes([twin('a'), twin('b', { state: 'inactive', skus: ['9'] })], 'a')).toEqual([]);
  });

  it('important: no tags, no pins — with or without sales', () => {
    expect(codes([product({ tags: [], posts: 0 })])).toEqual([
      'important:noTags',
      'important:noPins',
    ]);
  });

  it('notes: few tags, no views for a month', () => {
    expect(codes([product({ tags: ['a', 'b'] })])).toEqual(['note:fewTags']);
    expect(codes([product({ views: 0 })])).toEqual(['note:noViews']);
    expect(codes([product({ views: 0, listedAt: new Date('2026-11-01T00:00:00Z') })])).toEqual([]);
  });
});
