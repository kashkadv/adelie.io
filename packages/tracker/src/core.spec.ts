import { describe, expect, it } from 'vitest';
import { cleanProperties, cleanUrl, hostOf, propertiesFromAttributes, randomId } from './core.js';

describe('cleanUrl', () => {
  it('keeps only the campaign parameters of the query, and drops the fragment', () => {
    expect(
      cleanUrl(
        'https://gushka.ua/p/1?utm_source=pinterest&email=a@b.c&utm_medium=organic_social&epik=abc#reviews',
      ),
    ).toBe('https://gushka.ua/p/1?utm_source=pinterest&utm_medium=organic_social&epik=abc');
  });

  it('keeps the parameters the site allows; can drop the whole query', () => {
    expect(cleanUrl('https://a.com/c?page=2&token=x', ['page'])).toBe('https://a.com/c?page=2');
    expect(cleanUrl('https://a.com/c?utm_source=x', [], false)).toBe('https://a.com/c');
  });

  it('refuses what is not an http address, and cuts what is too long', () => {
    expect(cleanUrl('javascript:alert(1)')).toBe('');
    expect(cleanUrl('not a url')).toBe('');
    expect(cleanUrl(`https://a.com/${'x'.repeat(2000)}`).length).toBeLessThanOrEqual(1000);
  });
});

describe('hostOf', () => {
  it('the host without www', () => {
    expect(hostOf('https://www.Gushka.UA/x')).toBe('gushka.ua');
    expect(hostOf('nope')).toBeNull();
  });
});

describe('cleanProperties', () => {
  it('scalars under snake_case names; the rest is dropped', () => {
    expect(
      cleanProperties({
        item_id: 'x',
        price: 12.5,
        ok: true,
        nothing: null,
        BadKey: 1,
        fn: () => 1,
        obj: {},
        n: NaN,
      }),
    ).toEqual({ item_id: 'x', price: 12.5, ok: true, nothing: null });
  });

  it('long strings are cut, the number of keys is limited', () => {
    expect((cleanProperties({ a: 'x'.repeat(500) })['a'] as string).length).toBe(200);
    const many = Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`k${i}`, i]));
    expect(Object.keys(cleanProperties(many))).toHaveLength(20);
  });

  it('items: a list of up to 20 flat objects', () => {
    const items = Array.from({ length: 30 }, (_, i) => ({ item_id: i, deep: { no: 1 } }));
    const cleaned = cleanProperties({ items }).items as Record<string, unknown>[];
    expect(cleaned).toHaveLength(20);
    expect(cleaned[0]).toEqual({ item_id: 0 });
    expect(cleanProperties({ items: 'nope' })).toEqual({});
  });
});

describe('propertiesFromAttributes', () => {
  it('data-flipper-* → snake_case properties, numbers as numbers, the event name left out', () => {
    expect(
      propertiesFromAttributes([
        { name: 'data-flipper-event', value: 'AddToCart' },
        { name: 'data-flipper-product-id', value: 'A-7' },
        { name: 'data-flipper-price', value: '29.9' },
        { name: 'data-flipper-currency', value: 'USD' },
        { name: 'class', value: 'btn' },
      ]),
    ).toEqual({ product_id: 'A-7', price: 29.9, currency: 'USD' });
  });
});

describe('randomId', () => {
  it('32 hex characters, different each time', () => {
    const a = randomId();
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(randomId()).not.toBe(a);
  });
});
