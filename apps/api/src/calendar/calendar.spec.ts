import { describe, expect, it } from 'vitest';
import { addDays, carriedLinks, isDay, parseBudget, parseItem, weekStartOf } from './calendar.js';

describe('days and weeks', () => {
  it('only real days', () => {
    expect(isDay('2026-11-13')).toBe(true);
    expect(isDay('2026-02-30')).toBe(false);
    expect(isDay('13.11.2026')).toBe(false);
  });

  it('weeks start on Monday', () => {
    expect(weekStartOf('2026-11-13')).toBe('2026-11-09'); // Friday
    expect(weekStartOf('2026-11-09')).toBe('2026-11-09'); // Monday
    expect(weekStartOf('2026-11-15')).toBe('2026-11-09'); // Sunday
    expect(addDays('2026-12-29', 7)).toBe('2027-01-05');
  });
});

describe('items', () => {
  it('a new item needs a channel, a format and a title', () => {
    expect(
      parseItem({ channel: 'pinterest', format: 'pin', title: '  Karpaty rug ' }, true),
    ).toEqual({ ok: true, item: { channel: 'pinterest', format: 'pin', title: 'Karpaty rug' } });
    expect(parseItem({ channel: 'pinterest', format: 'pin' }, true)).toEqual({
      ok: false,
      error: 'title',
    });
    expect(parseItem({ channel: 'myspace', format: 'pin', title: 'x' }, true)).toEqual({
      ok: false,
      error: 'channel',
    });
  });

  it('a change touches only what it names; null clears', () => {
    expect(parseItem({ date: null, minutes: 0, notes: ' ' }, false)).toEqual({
      ok: true,
      item: { date: null, minutes: null, notes: null },
    });
    expect(parseItem({ status: 'published', date: '2026-11-14' }, false)).toEqual({
      ok: true,
      item: { status: 'published', date: '2026-11-14' },
    });
    expect(parseItem({ status: 'done' }, false)).toEqual({ ok: false, error: 'status' });
    expect(parseItem({ minutes: 2000 }, false)).toEqual({ ok: false, error: 'minutes' });
    expect(parseItem({ linkId: 'x' }, false)).toEqual({ ok: false, error: 'linkId' });
  });

  it('a budget is whole minutes or none', () => {
    expect(parseBudget(90)).toBe(90);
    expect(parseBudget(null)).toBeNull();
    expect(parseBudget(0)).toBeUndefined();
    expect(parseBudget('90')).toBeUndefined();
  });
});

describe('a published post carries the planned link', () => {
  const link = { code: 'qv0pl6d', source: 'instagram', content: 'біо' };
  it('by the short code', () => {
    expect(carriedLinks(['go.adelie.space/qv0pl6d']).has(link)).toBe(true);
  });
  it('by the labels of the full address', () => {
    expect(
      carriedLinks([
        'https://gushka.ua/p/1?utm_source=instagram&utm_medium=social&utm_content=%D0%B1%D1%96%D0%BE',
      ]).has(link),
    ).toBe(true);
    expect(
      carriedLinks(['https://gushka.ua/p/1?utm_source=pinterest&utm_content=біо']).has(link),
    ).toBe(false);
  });
});
