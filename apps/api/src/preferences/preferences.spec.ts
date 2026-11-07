import { describe, expect, it } from 'vitest';
import { isPreferenceKey, parsePreference } from './preferences.js';

describe('user preferences', () => {
  it('knows the Content columns keys per platform only', () => {
    expect(isPreferenceKey('content.columns.INSTAGRAM')).toBe(true);
    expect(isPreferenceKey('content.columns.FACEBOOK')).toBe(false);
    expect(isPreferenceKey('theme')).toBe(false);
  });

  it('keeps the chosen columns in their order', () => {
    expect(
      parsePreference('content.columns.INSTAGRAM', { columns: ['publishedAt', 'likes'], x: 1 }),
    ).toEqual({ ok: true, value: { columns: ['publishedAt', 'likes'] } });
  });

  it('rejects columns of another platform, duplicates and an empty list', () => {
    expect(parsePreference('content.columns.INSTAGRAM', { columns: ['impressions'] })).toEqual({
      ok: false,
      error: 'Unknown column',
    });
    expect(parsePreference('content.columns.PINTEREST', { columns: ['saves', 'saves'] }).ok).toBe(
      false,
    );
    expect(parsePreference('content.columns.PINTEREST', { columns: [] }).ok).toBe(false);
    expect(parsePreference('content.columns.PINTEREST', null).ok).toBe(false);
  });
});
