// A product's own tags against the research's rated tags (ADR-0034): which are strong, fine, weak,
// do not fit the niche, or were not checked — and the best rated tags it does not have yet to
// replace the weak ones. Pure and unit-tested.
import { phraseKey, type RatedTag } from './research.js';

export type TagVerdict = 'strong' | 'ok' | 'weak' | 'off' | 'unknown';

export interface TagAudit {
  tags: { tag: string; verdict: TagVerdict; score: number | null }[];
  counts: Record<TagVerdict, number>;
  /** Rated tags the product lacks, better than its weak ones — the replacements to consider. */
  replacements: { tag: string; score: number }[];
}

export const STRONG = 55;
export const OK = 35;

export function auditTags(
  productTags: string[],
  ratedOf: Map<string, RatedTag>,
  rated: RatedTag[],
  isVisible: (phrase: string) => boolean,
): TagAudit {
  const counts: Record<TagVerdict, number> = { strong: 0, ok: 0, weak: 0, off: 0, unknown: 0 };
  const tags = productTags.map((tag) => {
    const r = ratedOf.get(phraseKey(tag));
    const verdict: TagVerdict = !isVisible(tag)
      ? 'off'
      : !r
        ? 'unknown'
        : r.score >= STRONG
          ? 'strong'
          : r.score >= OK
            ? 'ok'
            : 'weak';
    counts[verdict]++;
    return { tag, verdict, score: r?.score ?? null };
  });
  const has = new Set(productTags.map(phraseKey));
  const toReplace = counts.weak + counts.off + Math.max(0, 13 - productTags.length);
  const floor = Math.max(
    OK,
    ...tags.filter((t) => t.verdict === 'weak').map((t) => (t.score ?? 0) + 1),
  );
  return {
    tags,
    counts,
    replacements: toReplace
      ? rated
          .filter((r) => !has.has(phraseKey(r.tag)) && r.score >= floor)
          .slice(0, Math.min(8, toReplace + 3))
          .map((r) => ({ tag: r.tag, score: r.score }))
      : [],
  };
}
