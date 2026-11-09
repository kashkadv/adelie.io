import { describe, expect, it } from 'vitest';
import {
  cleanAddress,
  dailyId,
  deviceOf,
  isBot,
  parseBatch,
  RateLimiter,
  visitOf,
} from './ingest.js';

const NOW = new Date('2026-11-10T12:00:00Z');
const ID = 'a'.repeat(32);
const body = (over: Record<string, unknown> = {}, event: Record<string, unknown> = {}) =>
  JSON.stringify({
    s: 'fl_testsite01',
    c: 0,
    e: [
      {
        id: ID,
        n: 'PageView',
        t: NOW.getTime(),
        u: 'https://gushka.ua/p/1?utm_source=pinterest&email=x',
        ti: ' Rug ',
        p: {},
        ...event,
      },
    ],
    ...over,
  });

describe('parseBatch', () => {
  it('a well-formed batch, its address cleaned and its title trimmed', () => {
    const b = parseBatch(body(), NOW)!;
    expect(b).toMatchObject({
      siteId: 'fl_testsite01',
      consent: false,
      visitorId: null,
      sessionId: null,
    });
    expect(b.events[0]).toMatchObject({
      eventId: ID,
      name: 'PageView',
      url: 'https://gushka.ua/p/1?utm_source=pinterest',
      host: 'gushka.ua',
      title: 'Rug',
      properties: null,
    });
  });

  it('visitor and session count only with consent', () => {
    const v = 'b'.repeat(32);
    expect(parseBatch(body({ c: 1, v, ss: v }), NOW)).toMatchObject({
      consent: true,
      visitorId: v,
      sessionId: v,
    });
    expect(parseBatch(body({ c: 0, v, ss: v }), NOW)).toMatchObject({
      visitorId: null,
      sessionId: null,
    });
    expect(parseBatch(body({ c: 1, v: 'short' }), NOW)!.visitorId).toBeNull();
  });

  it.each([
    ['not json', 'nope'],
    ['no site', JSON.stringify({ e: [] })],
    ['a bad site id', body({ s: 'x' })],
    ['no events', body({ e: [] })],
    [
      'too many events',
      body({
        e: Array.from({ length: 26 }, (_, i) => ({ id: ID, n: 'A', u: 'https://a.com/', i })),
      }),
    ],
    ['an event of no good', body({ e: [{ id: 'x', n: 'PageView', u: 'https://a.com/' }] })],
  ])('refuses %s', (_name, raw) => {
    expect(parseBatch(raw, NOW)).toBeNull();
  });

  it('refuses a body that is too large', () => {
    expect(parseBatch(body({}, { ti: 'x'.repeat(40_000) }), NOW)).toBeNull();
  });

  it('skips the events that are not valid and keeps the others', () => {
    const b = parseBatch(
      JSON.stringify({
        s: 'fl_testsite01',
        c: 0,
        e: [
          { id: 'bad' },
          { id: ID, n: 'AddToCart', u: 'https://a.com/x' },
          { id: ID, n: 'bad name', u: 'https://a.com/' },
          { id: ID, n: 'X', u: 'javascript:1' },
        ],
      }),
      NOW,
    )!;
    expect(b.events.map((e) => e.name)).toEqual(['AddToCart']);
  });

  it('a clock that is a day off is replaced by the time of receipt', () => {
    expect(
      parseBatch(body({}, { t: NOW.getTime() - 3 * 86_400_000 }), NOW)!.events[0]!.occurredAt,
    ).toEqual(NOW);
    expect(parseBatch(body({}, { t: NOW.getTime() - 60_000 }), NOW)!.events[0]!.occurredAt).toEqual(
      new Date(NOW.getTime() - 60_000),
    );
  });

  it('properties are cleaned like the browser does it', () => {
    const b = parseBatch(
      body(
        {},
        {
          p: {
            item_id: 'x',
            price: 9.9,
            BadKey: 1,
            nested: { a: 1 },
            items: [{ item_id: 'a', deep: { no: 1 } }, 'junk'],
          },
        },
      ),
      NOW,
    )!;
    expect(b.events[0]!.properties).toEqual({
      item_id: 'x',
      price: 9.9,
      items: [{ item_id: 'a' }],
    });
  });
});

describe('visitOf', () => {
  it('a consenting visitor’s session attribution applies to all its events; anonymous: only an arrival says it', () => {
    const consenting = parseBatch(
      body(
        {
          c: 1,
          v: ID,
          ss: ID,
          a: { l: 'https://gushka.ua/?utm_source=pinterest&utm_medium=organic_social', r: '' },
        },
        { n: 'AddToCart' },
      ),
      NOW,
    )!;
    expect(visitOf(consenting, consenting.events[0]!)).toMatchObject({
      source: 'pinterest',
      channel: 'Organic Social',
    });
    const anonymous = parseBatch(
      body({}, { a: { l: 'https://gushka.ua/', r: 'https://www.google.com/' } }),
      NOW,
    )!;
    expect(visitOf(anonymous, anonymous.events[0]!)).toMatchObject({
      source: 'google',
      channel: 'Organic Search',
    });
    const plain = parseBatch(body(), NOW)!;
    expect(visitOf(plain, plain.events[0]!)).toBeNull();
  });
});

describe('cleanAddress', () => {
  it('cuts the query to the campaign parameters', () => {
    expect(cleanAddress('https://a.com/x?q=1&gclid=z#f')).toEqual({
      url: 'https://a.com/x?gclid=z',
      host: 'a.com',
    });
    expect(cleanAddress('ftp://a.com')).toBeNull();
  });
});

describe('bots and devices', () => {
  it('recognises the obvious bots and the kind of device', () => {
    expect(isBot('Mozilla/5.0 (compatible; Googlebot/2.1)')).toBe(true);
    expect(isBot('')).toBe(true);
    expect(isBot('Mozilla/5.0 (iPhone; CPU iPhone OS 17) Safari')).toBe(false);
    expect(deviceOf('Mozilla/5.0 (iPhone; CPU iPhone OS 17) Mobile Safari')).toBe('mobile');
    expect(deviceOf('Mozilla/5.0 (iPad; CPU OS 17)')).toBe('tablet');
    expect(deviceOf('Mozilla/5.0 (Windows NT 10.0) Chrome')).toBe('desktop');
  });
});

describe('dailyId', () => {
  it('the same visitor on the same day is the same; another day, another site or another browser is not', () => {
    const a = dailyId('secret', '2026-11-10', 'S1', '1.2.3.4', 'UA');
    expect(dailyId('secret', '2026-11-10', 'S1', '1.2.3.4', 'UA')).toBe(a);
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(dailyId('secret', '2026-11-11', 'S1', '1.2.3.4', 'UA')).not.toBe(a);
    expect(dailyId('secret', '2026-11-10', 'S2', '1.2.3.4', 'UA')).not.toBe(a);
    expect(dailyId('secret', '2026-11-10', 'S1', '1.2.3.4', 'UA2')).not.toBe(a);
    expect(dailyId('other', '2026-11-10', 'S1', '1.2.3.4', 'UA')).not.toBe(a);
  });
});

describe('RateLimiter', () => {
  it('lets `limit` through in a window, then none, then again in the next window', () => {
    const r = new RateLimiter(3, 1000);
    expect([0, 1, 2, 3, 4].map(() => r.allow('k', 0))).toEqual([true, true, true, false, false]);
    expect(r.allow('other', 0)).toBe(true);
    expect(r.allow('k', 1500)).toBe(true);
  });
});
