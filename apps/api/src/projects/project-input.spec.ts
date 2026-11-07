import { describe, expect, it } from 'vitest';
import { parseProjectInput } from './project-input.js';

describe('parseProjectInput', () => {
  it('accepts a full valid project and normalizes it', () => {
    expect(
      parseProjectInput(
        { name: '  Gushka   shop ', timezone: 'Europe/Kyiv', currency: 'uah', reportLocale: 'uk' },
        true,
      ),
    ).toEqual({
      ok: true,
      data: { name: 'Gushka shop', timezone: 'Europe/Kyiv', currency: 'UAH', reportLocale: 'uk' },
    });
  });

  it('requires a name on create but not on update', () => {
    expect(parseProjectInput({}, true)).toEqual({ ok: false, errors: { name: 'required' } });
    expect(parseProjectInput({ currency: 'EUR' }, false)).toEqual({
      ok: true,
      data: { currency: 'EUR' },
    });
  });

  it('reports every invalid field', () => {
    expect(
      parseProjectInput(
        { name: 'x'.repeat(81), timezone: 'Mars/Base', currency: 'ZZZ', reportLocale: 'de' },
        false,
      ),
    ).toEqual({
      ok: false,
      errors: {
        name: 'tooLong',
        timezone: 'invalidTimezone',
        currency: 'invalidCurrency',
        reportLocale: 'invalidLocale',
      },
    });
  });

  it('rejects blank names and wrong types', () => {
    expect(parseProjectInput({ name: '   ' }, false)).toEqual({
      ok: false,
      errors: { name: 'required' },
    });
    expect(parseProjectInput({ name: 5, timezone: 1 }, false)).toEqual({
      ok: false,
      errors: { name: 'invalidType', timezone: 'invalidType' },
    });
    expect(parseProjectInput(null, true)).toEqual({ ok: false, errors: {} });
  });
});
