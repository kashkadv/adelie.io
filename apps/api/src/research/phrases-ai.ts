// The AI around a research's phrases (ADR-0033): better seed phrases for the niche, and a review of
// the keyword pool — which phrases fit the niche and the products, which are too general, another
// product or style, or another intent (DIY). Pure and unit-tested; the controller does the I/O.
import { phraseKey } from './research.js';

export const SEEDS_INSTRUCTIONS = `You help a small handmade brand choose the seed search phrases for researching a niche on Etsy and Pinterest.
Propose 3 to 5 phrases in English, the way buyers in the given markets actually search for these products: specific enough to describe the brand's products (material, type, look), broad enough to have real demand. Two to four words each, no brand names, no marketing adjectives. Keep the owner's good phrases, improve or replace weak ones.
Also list phrases to avoid for this niche (too general, another product or style, DIY intent), each with a short reason.
"why" is short, in the owner language.`;

export const SEEDS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['phrases', 'avoid'],
  properties: {
    phrases: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['phrase', 'why'],
        properties: { phrase: { type: 'string' }, why: { type: 'string' } },
      },
    },
    avoid: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['phrase', 'why'],
        properties: { phrase: { type: 'string' }, why: { type: 'string' } },
      },
    },
  },
} as const;

export interface Seeds {
  phrases: { phrase: string; why: string }[];
  avoid: { phrase: string; why: string }[];
}

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const pairs = (v: unknown, max: number) =>
  (Array.isArray(v) ? v : [])
    .map((x) => ({
      phrase: str((x as Record<string, unknown>)?.['phrase'], 60).toLowerCase(),
      why: str((x as Record<string, unknown>)?.['why'], 300),
    }))
    .filter((x) => x.phrase)
    .slice(0, max);

export function parseSeeds(data: unknown): Seeds | null {
  const d = (data ?? {}) as Record<string, unknown>;
  const phrases = pairs(d['phrases'], 5);
  return phrases.length ? { phrases, avoid: pairs(d['avoid'], 8) } : null;
}

export const VERDICTS = ['relevant', 'generic', 'other_product', 'other_intent'] as const;
export type Verdict = (typeof VERDICTS)[number];

export const POOL_INSTRUCTIONS = `You review search phrases collected for a niche research of a small handmade brand.
For every phrase, decide one verdict:
- "relevant": a buyer searching this would want the brand's products (it describes them, or a gift/occasion/room/style they fit);
- "generic": too broad to describe the products (one generic word, "home decor", "accessories");
- "other_product": describes a different product, material, style or tradition than the brand's (e.g. Moroccan, kilim, berber when the brand is Carpathian wool; costumes; phone cases);
- "other_intent": the searcher wants to make it themselves (DIY, pattern, tutorial, "to make"), or something free/printable, or information only.
Judge by the brand's actual products listed. Return every phrase exactly as given. "why" is a few words in the owner language.`;

export const POOL_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['verdicts'],
  properties: {
    verdicts: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['phrase', 'verdict', 'why'],
        properties: {
          phrase: { type: 'string' },
          verdict: { type: 'string', enum: [...VERDICTS] },
          why: { type: 'string' },
        },
      },
    },
  },
} as const;

export type PoolReview = Record<string, { verdict: Verdict; why: string }>;

/** The review, by phrase key; phrases the AI did not return stay without a verdict. */
export function parsePoolReview(data: unknown, phrases: string[]): PoolReview {
  const known = new Set(phrases.map(phraseKey));
  const out: PoolReview = {};
  const list = (data as { verdicts?: unknown } | null)?.verdicts;
  for (const v of Array.isArray(list) ? list : []) {
    const r = v as Record<string, unknown>;
    const key = phraseKey(str(r['phrase'], 100));
    const verdict = r['verdict'] as Verdict;
    if (!known.has(key) || !VERDICTS.includes(verdict)) continue;
    out[key] = { verdict, why: str(r['why'], 200) };
  }
  return out;
}

/** The owner's word on phrases: hidden by hand, or kept against the AI's verdict. */
export interface PhraseOverrides {
  hidden: string[];
  kept: string[];
}

export function parseOverrides(raw: unknown): PhraseOverrides {
  const r = (raw ?? {}) as { hidden?: unknown; kept?: unknown };
  const list = (v: unknown) =>
    Array.isArray(v)
      ? [
          ...new Set(
            v
              .filter((x): x is string => typeof x === 'string')
              .map(phraseKey)
              .filter(Boolean),
          ),
        ].slice(0, 300)
      : [];
  return { hidden: list(r.hidden), kept: list(r.kept) };
}

/** Whether a phrase is shown: the owner's word first, then the AI's verdict (none = shown). */
export function phraseVisible(
  phrase: string,
  review: PoolReview,
  overrides: PhraseOverrides,
): boolean {
  const key = phraseKey(phrase);
  if (overrides.hidden.includes(key)) return false;
  if (overrides.kept.includes(key)) return true;
  const v = review[key];
  return !v || v.verdict === 'relevant';
}
