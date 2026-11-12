import { describe, expect, it } from 'vitest';
import {
  goalSql,
  kindOf,
  parseGoal,
  parseSettings,
  patternToRegex,
  settingsOf,
  stepSql,
} from './site-kinds.js';

describe('site kinds', () => {
  it('unknown or missing kinds read as a shop', () => {
    expect(kindOf('landing')).toBe('landing');
    expect(kindOf('blog')).toBe('store');
    expect(kindOf(null)).toBe('store');
  });

  it('a site without settings gets its kind’s funnel', () => {
    expect(settingsOf({ kind: 'store', goals: [], funnel: null }).funnel[0]).toEqual({
      event: 'ViewCategory',
    });
    const landing = settingsOf({ kind: 'landing', goals: [], funnel: null });
    expect(landing.funnel).toEqual([{ event: 'PageView' }]);
    expect(landing.tabs).toEqual([]);
  });
});

describe('goals', () => {
  it('normalises an outbound host and keeps a path', () => {
    expect(
      parseGoal({
        id: 'download',
        name: ' Download ',
        rule: { type: 'outbound', host: 'https://www.NexusMods.com/ets2', path: '/ets2/mods' },
      }),
    ).toEqual({
      id: 'download',
      name: 'Download',
      rule: { type: 'outbound', host: 'nexusmods.com', path: '/ets2/mods' },
    });
  });

  it('rejects bad ids, event names, page patterns and hosts', () => {
    expect(parseGoal({ id: 'Bad Id', rule: { type: 'event', event: 'Purchase' } })).toBeNull();
    expect(parseGoal({ id: 'x', rule: { type: 'event', event: 'drop table' } })).toBeNull();
    expect(parseGoal({ id: 'x', rule: { type: 'page', pattern: 'thanks' } })).toBeNull();
    expect(parseGoal({ id: 'x', rule: { type: 'outbound', host: 'localhost' } })).toBeNull();
  });

  it('a funnel refers only to known goals; null means the kind’s funnel', () => {
    const goals = [{ id: 'download', rule: { type: 'outbound', host: 'nexusmods.com' } }];
    expect(parseSettings(goals, [{ event: 'PageView' }, { goal: 'download' }])).toMatchObject({
      ok: true,
    });
    expect(parseSettings(goals, [{ goal: 'donate' }])).toEqual({ ok: false, error: 'funnel' });
    expect(parseSettings(goals, null)).toMatchObject({ ok: true, funnel: null });
    expect(parseSettings([goals[0], goals[0]], null)).toEqual({ ok: false, error: 'goals' });
  });

  it('page patterns become anchored regular expressions', () => {
    expect(patternToRegex('/thanks/')).toBe('^/thanks/?$');
    expect(patternToRegex('/download/*')).toBe('^/download/.*/?$');
    expect(new RegExp(patternToRegex('/download/*')).test('/download/v1.2')).toBe(true);
    expect(new RegExp(patternToRegex('/a.b')).test('/aXb')).toBe(false);
  });

  it('rules become parameterised SQL', () => {
    const page = goalSql({ type: 'page', pattern: '/thanks' });
    expect(page.values).toEqual(['^/thanks/?$']);
    const out = goalSql({ type: 'outbound', host: 'ko-fi.com', path: '/gushka_' });
    expect(out.values).toEqual(['ko-fi.com', '%.ko-fi.com', '/gushka\\_%']);
    expect(out.sql).toContain("name = 'OutboundClick'");
    expect(stepSql({ goal: 'missing' }, []).sql).toBe('false');
  });
});
