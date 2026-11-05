import { describe, expect, it } from 'vitest';
import { parseAvatarDataUrl } from './avatar.js';
import {
  fullName,
  normalizeLinkedin,
  normalizePhone,
  normalizeTelegram,
  parseProfileUpdate,
  splitName,
} from './profile-input.js';

describe('normalizers', () => {
  it('phone: keeps + and digits, rejects garbage and wrong length', () => {
    expect(normalizePhone('+38 (067) 123-45-67')).toBe('+380671234567');
    expect(normalizePhone('0671234567')).toBe('0671234567');
    expect(normalizePhone('call me')).toBeNull();
    expect(normalizePhone('12345')).toBeNull();
  });

  it('telegram: accepts @name, links and bare names', () => {
    expect(normalizeTelegram('@adelie_space')).toBe('adelie_space');
    expect(normalizeTelegram('https://t.me/adelie_space')).toBe('adelie_space');
    expect(normalizeTelegram('t.me/adelie_space/')).toBe('adelie_space');
    expect(normalizeTelegram('abc')).toBeNull();
    expect(normalizeTelegram('bad name!')).toBeNull();
  });

  it('linkedin: only linkedin.com URLs with a path, normalized to https', () => {
    expect(normalizeLinkedin('linkedin.com/in/dmytro')).toBe('https://linkedin.com/in/dmytro');
    expect(normalizeLinkedin('http://ua.linkedin.com/in/dmytro#x')).toBe(
      'https://ua.linkedin.com/in/dmytro',
    );
    expect(normalizeLinkedin('https://evil.com/linkedin.com/in/x')).toBeNull();
    expect(normalizeLinkedin('https://linkedin.com/')).toBeNull();
  });

  it('names', () => {
    expect(splitName('Dmytro Kashka')).toEqual({ firstName: 'Dmytro', lastName: 'Kashka' });
    expect(splitName('Dmytro')).toEqual({ firstName: 'Dmytro', lastName: null });
    expect(fullName('Dmytro', null)).toBe('Dmytro');
  });
});

describe('parseProfileUpdate', () => {
  it('trims, turns empty strings into null and normalizes values', () => {
    const r = parseProfileUpdate({
      firstName: '  Dmytro ',
      jobTitle: '',
      contactEmail: 'Hello@Adelie.Space',
      telegram: '@adelie_space',
      timezone: 'Europe/Kyiv',
      workDays: [5, 1, 1, 3],
      workStart: '09:00',
      workEnd: '18:00',
    });
    expect(r).toEqual({
      ok: true,
      data: {
        firstName: 'Dmytro',
        jobTitle: null,
        contactEmail: 'hello@adelie.space',
        telegram: 'adelie_space',
        timezone: 'Europe/Kyiv',
        workDays: [1, 3, 5],
        workStart: '09:00',
        workEnd: '18:00',
      },
    });
  });

  it('leaves fields that were not sent untouched', () => {
    expect(parseProfileUpdate({ phone: null })).toEqual({ ok: true, data: { phone: null } });
  });

  it('reports every invalid field with a code', () => {
    const r = parseProfileUpdate({
      firstName: 'x'.repeat(81),
      contactEmail: 'nope',
      phone: 'abc',
      linkedin: 'facebook.com/me',
      timezone: 'Mars/Base',
      workDays: [0, 8],
      workStart: '9:00',
    });
    expect(r).toEqual({
      ok: false,
      errors: {
        firstName: 'tooLong',
        contactEmail: 'invalidEmail',
        phone: 'invalidPhone',
        linkedin: 'invalidLinkedin',
        timezone: 'invalidTimezone',
        workDays: 'invalidDays',
        workStart: 'invalidTime',
      },
    });
  });

  it('working hours: both ends required, end after start', () => {
    expect(parseProfileUpdate({ workStart: '09:00' })).toEqual({
      ok: false,
      errors: { workEnd: 'timeRequired' },
    });
    expect(parseProfileUpdate({ workStart: '18:00', workEnd: '09:00' })).toEqual({
      ok: false,
      errors: { workEnd: 'endBeforeStart' },
    });
    expect(parseProfileUpdate({ workStart: null, workEnd: null })).toEqual({
      ok: true,
      data: { workStart: null, workEnd: null },
    });
  });

  it('rejects non-object bodies and wrong types', () => {
    expect(parseProfileUpdate(null).ok).toBe(false);
    expect(parseProfileUpdate({ firstName: 42 })).toEqual({
      ok: false,
      errors: { firstName: 'invalidType' },
    });
  });
});

describe('parseAvatarDataUrl', () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);

  it('accepts an image whose bytes match the declared type', () => {
    const r = parseAvatarDataUrl(`data:image/png;base64,${png.toString('base64')}`);
    expect(r).toMatchObject({ ok: true, mime: 'image/png' });
  });

  it('rejects a mismatched type, other formats and oversized files', () => {
    expect(parseAvatarDataUrl(`data:image/jpeg;base64,${png.toString('base64')}`)).toEqual({
      ok: false,
      error: 'invalidImage',
    });
    expect(parseAvatarDataUrl('data:image/svg+xml;base64,PHN2Zz4=')).toEqual({
      ok: false,
      error: 'invalidImage',
    });
    const big = Buffer.concat([png, Buffer.alloc(200 * 1024)]);
    expect(parseAvatarDataUrl(`data:image/png;base64,${big.toString('base64')}`)).toEqual({
      ok: false,
      error: 'tooLarge',
    });
  });
});
