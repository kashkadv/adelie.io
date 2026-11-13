import { describe, expect, it } from 'vitest';
import type { RatedTag } from './research.js';
import { auditTags } from './tag-audit.js';

const rated = (tag: string, score: number): RatedTag => ({
  tag,
  score,
  count: 1000,
  priceMedian: null,
  avgFavorers: 10,
  competition: 'medium',
  competitors: 5,
  pinterestMom: null,
  own: 0,
  priceVsOwn: null,
});

describe('tag audit', () => {
  const list = [
    rated('shaggy pillow', 80),
    rated('boho pillow cover', 60),
    rated('wool cushion', 40),
    rated('pillow', 20),
    rated('textured pillow', 70),
  ];
  const of = new Map(list.map((r) => [r.tag, r]));

  it('says which of the product’s tags are strong, fine, weak, off or unchecked', () => {
    const audit = auditTags(
      ['Shaggy Pillows', 'wool cushion', 'pillow', 'moroccan pillow', 'carpathian'],
      of,
      list,
      (t) => t !== 'moroccan pillow',
    );
    expect(audit.tags.map((t) => t.verdict)).toEqual(['strong', 'ok', 'weak', 'off', 'unknown']);
    expect(audit.counts).toEqual({ strong: 1, ok: 1, weak: 1, off: 1, unknown: 1 });
  });

  it('offers better rated tags the product lacks', () => {
    // `rated` comes sorted by score, best first.
    const sorted = [...list].sort((a, b) => b.score - a.score);
    const audit = auditTags(['shaggy pillow', 'pillow'], of, sorted, () => true);
    expect(audit.replacements.map((r) => r.tag)).toEqual(
      ['boho pillow cover', 'wool cushion', 'textured pillow'].sort(
        (a, b) => of.get(b)!.score - of.get(a)!.score,
      ),
    );
    expect(audit.replacements.every((r) => r.score > 20)).toBe(true);
  });

  it('a full set of good tags needs nothing', () => {
    const tags = Array.from({ length: 13 }, (_, i) => `tag ${i}`);
    const many = tags.map((t) => rated(t, 90));
    const audit = auditTags(
      tags,
      new Map(many.map((r) => [r.tag, r])),
      [...many, rated('extra one', 95)],
      () => true,
    );
    expect(audit.replacements).toEqual([]);
  });
});
