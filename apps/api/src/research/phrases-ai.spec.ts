import { describe, expect, it } from 'vitest';
import {
  POOL_SCHEMA,
  SEEDS_SCHEMA,
  parseOverrides,
  parsePoolReview,
  parseSeeds,
  phraseVisible,
} from './phrases-ai.js';

describe('seed phrases', () => {
  it('are parsed and lower-cased; without phrases there is nothing', () => {
    expect(
      parseSeeds({
        phrases: [{ phrase: ' Shaggy Wool Pillow ', why: 'w' }, { phrase: '' }],
        avoid: [{ phrase: 'Pillow', why: 'too general' }],
      }),
    ).toEqual({
      phrases: [{ phrase: 'shaggy wool pillow', why: 'w' }],
      avoid: [{ phrase: 'pillow', why: 'too general' }],
    });
    expect(parseSeeds({ phrases: [] })).toBeNull();
  });

  it('the schemas are strict', () => {
    expect([...SEEDS_SCHEMA.required].sort()).toEqual(Object.keys(SEEDS_SCHEMA.properties).sort());
    const item = POOL_SCHEMA.properties.verdicts.items;
    expect([...item.required].sort()).toEqual(Object.keys(item.properties).sort());
  });
});

describe('pool review', () => {
  const phrases = ['wool pillow', 'moroccan pillow', 'christmas pillow make', 'pillow'];
  const review = parsePoolReview(
    {
      verdicts: [
        { phrase: 'Wool Pillows', verdict: 'relevant', why: '' },
        { phrase: 'moroccan pillow', verdict: 'other_product', why: 'інший стиль' },
        { phrase: 'christmas pillow make', verdict: 'other_intent', why: 'DIY' },
        { phrase: 'invented phrase', verdict: 'relevant', why: '' },
        { phrase: 'pillow', verdict: 'maybe', why: '' },
      ],
    },
    phrases,
  );

  it('keeps verdicts for the given phrases only', () => {
    expect(Object.keys(review).sort()).toEqual([
      'christmas pillow make',
      'moroccan pillow',
      'wool pillow',
    ]);
  });

  it('hides what does not fit; the owner’s word wins', () => {
    const none = parseOverrides(null);
    expect(phraseVisible('wool pillow', review, none)).toBe(true);
    expect(phraseVisible('moroccan pillow', review, none)).toBe(false);
    expect(phraseVisible('pillow', review, none)).toBe(true); // no verdict: shown
    const owner = parseOverrides({ hidden: ['Wool Pillows'], kept: ['moroccan pillow'] });
    expect(phraseVisible('wool pillow', review, owner)).toBe(false);
    expect(phraseVisible('moroccan pillow', review, owner)).toBe(true);
  });
});
