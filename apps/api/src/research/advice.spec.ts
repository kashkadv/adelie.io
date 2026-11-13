import { describe, expect, it } from 'vitest';
import {
  ADVICE_SCHEMA,
  adviceInstructions,
  checkAdvice,
  contextBlocks,
  parseAdvice,
  parseContext,
} from './advice.js';
import { easter, eventsIn } from './events.js';

describe('events', () => {
  it('computes the moving dates', () => {
    expect(easter(2026)).toBe('2026-04-05');
    expect(easter(2027)).toBe('2027-03-28');
    const year = eventsIn(['US'], '2026-11-01', '2026-12-31', 14);
    const thanksgiving = year.find((e) => e.key === 'thanksgiving')!;
    expect(thanksgiving.date).toBe('2026-11-26');
    expect(year.find((e) => e.key === 'black_friday')!.date).toBe('2026-11-27');
    expect(year.find((e) => e.key === 'cyber_monday')!.date).toBe('2026-11-30');
  });

  it('keeps the markets’ events and gives the last day to order for gifts', () => {
    const us = eventsIn(['US', 'AU'], '2026-11-13', '2026-12-31', 14);
    expect(us.map((e) => e.key)).toEqual([
      'thanksgiving',
      'black_friday',
      'small_business_saturday',
      'cyber_monday',
      'hanukkah',
      'christmas',
      'boxing_day',
    ]);
    // 14 days of delivery + 2 to make and send.
    expect(us.find((e) => e.key === 'christmas')!.orderBy).toBe('2026-12-09');
    expect(us.find((e) => e.key === 'thanksgiving')!.orderBy).toBeNull();
    expect(us.find((e) => e.key === 'boxing_day')!.countries).toEqual(['AU']);
    expect(eventsIn(['DE'], '2026-12-01', '2026-12-10', null).map((e) => e.key)).toEqual([
      'st_nicholas',
    ]);
  });
});

describe('context', () => {
  const base = {
    today: '2026-11-13',
    endsOn: '2026-12-09',
    markets: [
      { code: 'US', share: 72 },
      { code: 'AU', share: 18 },
    ],
    deliveryDays: 14,
    salesPlatform: 'ETSY' as const,
    channel: 'pinterest',
    brand: { about: 'Handmade wool from the Carpathians', audience: '', goal: 'Etsy sales' },
    pool: [
      {
        phrase: 'christmas throw pillow',
        pinterest: { mom: 400, yoy: -40, regions: ['US'], peak: null },
        etsy: 0,
        own: 0,
        score: 3,
      },
    ],
    etsy: [],
  };

  it('builds the automatic blocks from the research’s fields', () => {
    const blocks = contextBlocks({ ...base, context: { own: [], off: [] } });
    expect(blocks.map((b) => b.key)).toEqual([
      'season',
      'markets',
      'etsy_rules',
      'pinterest_rules',
      'brand',
      'research_data',
    ]);
    expect(blocks[0]!.text).toContain(
      'Christmas: 2026-12-25; last day to order for delivery: 2026-12-09',
    );
    expect(blocks[1]!.text).toContain('US 72%');
    expect(blocks[5]!.text).toContain('christmas throw pillow | 400% / -40%');
  });

  it('switches blocks off and adds the owner’s; only enabled ones reach the AI', () => {
    const context = parseContext({
      own: [{ id: 'tone', text: 'No “ethnic”; say “Carpathian”.' }, { text: '' }],
      off: ['brand'],
    });
    const blocks = contextBlocks({ ...base, context });
    expect(blocks.find((b) => b.key === 'brand')!.enabled).toBe(false);
    const text = adviceInstructions(blocks);
    expect(text).toContain('## owner note\nNo “ethnic”');
    expect(text).not.toContain('About the brand');
  });
});

describe('advice', () => {
  it('the schema is strict', () => {
    expect([...ADVICE_SCHEMA.required].sort()).toEqual(
      Object.keys(ADVICE_SCHEMA.properties).sort(),
    );
  });

  it('is parsed and checked against Etsy’s and Pinterest’s limits', () => {
    const advice = parseAdvice({
      titles: [
        { title: 'Shaggy Wool Pillow Cover 18x18, Christmas Throw Pillow, Cozy Gift', why: 'w' },
        { title: 'wool wool wool pillow', why: '' },
      ],
      tags: ['Shaggy Pillow', 'shaggy pillow', 'christmas throw pillow cover', 'gift/for her'],
      tagsWhy: '',
      opening: 'o',
      openingWhy: '',
      pins: [{ title: 'x'.repeat(120), description: 'd' }],
    })!;
    expect(advice.tags).toEqual(['shaggy pillow', 'christmas throw pillow cover', 'gift/for her']);
    expect(checkAdvice(advice)).toEqual([
      { code: 'titleRepeats', index: 1, word: 'wool' },
      { code: 'tagsCount', count: 3 },
      { code: 'tagLong', tag: 'christmas throw pillow cover', length: 28 },
      { code: 'tagChars', tag: 'gift/for her' },
      { code: 'pinTitleLong', index: 0, length: 120 },
    ]);
    expect(parseAdvice({})).toBeNull();
  });
});
