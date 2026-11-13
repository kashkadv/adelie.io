// Advice for a product of a research (ADR-0032, stage 2): the context the AI gets, assembled from
// blocks — automatic ones (season and deadlines, markets, the sales point's and the channel's rules,
// the brand, the research's data, the product) and the owner's own — the answer's schema, and the
// deterministic checks of Etsy's and Pinterest's limits. Pure and unit-tested.
import { eventsIn } from './events.js';
import type { EtsyMarket, Market, PoolPhrase, RatedTag } from './research.js';

export interface ContextBlock {
  key: string;
  /** Made by Adelie from the research's fields, or written by the owner. */
  auto: boolean;
  enabled: boolean;
  text: string;
}

export interface OwnBlock {
  id: string;
  text: string;
  enabled: boolean;
}

/** The owner's blocks and the automatic ones switched off, as stored in `research.context`. */
export function parseContext(raw: unknown): { own: OwnBlock[]; off: string[] } {
  const c = (raw ?? {}) as { own?: unknown; off?: unknown };
  const own = Array.isArray(c.own)
    ? c.own
        .filter((b): b is Record<string, unknown> => !!b && typeof b === 'object')
        .map((b, i) => ({
          id:
            typeof b['id'] === 'string' && /^[a-z0-9-]{1,40}$/.test(b['id'])
              ? b['id']
              : `own${i + 1}`,
          text: typeof b['text'] === 'string' ? b['text'].trim().slice(0, 1500) : '',
          enabled: b['enabled'] !== false,
        }))
        .filter((b) => b.text)
        .slice(0, 10)
    : [];
  const off = Array.isArray(c.off)
    ? c.off.filter((k): k is string => typeof k === 'string').slice(0, 20)
    : [];
  return { own, off };
}

const addDays = (day: string, n: number) => {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

export interface ContextInput {
  today: string;
  endsOn: string | null;
  markets: Market[];
  deliveryDays: number | null;
  salesPlatform: 'ETSY' | 'WEBSITE' | null;
  channel: string;
  brand: { about: string; audience: string; goal: string } | null;
  pool: PoolPhrase[];
  etsy: EtsyMarket[];
  /** Rated candidate tags (ADR-0034), best first. */
  tags?: RatedTag[];
  context: { own: OwnBlock[]; off: string[] };
}

/** The automatic blocks and the owner's, in the order the AI reads them. */
export function contextBlocks(input: ContextInput): ContextBlock[] {
  const codes = input.markets.map((m) => m.code);
  const to = input.endsOn && input.endsOn > input.today ? input.endsOn : addDays(input.today, 60);
  const events = eventsIn(codes, input.today, addDays(to, 30), input.deliveryDays);
  const blocks: Omit<ContextBlock, 'enabled'>[] = [];

  if (events.length) {
    blocks.push({
      key: 'season',
      auto: true,
      text: [
        `Today is ${input.today}; the season runs until ${to}.`,
        'Holidays and shopping events in the markets:',
        ...events.map(
          (e) =>
            `- ${e.name}: ${e.date}${e.countries.includes('*') ? '' : ` (${e.countries.join(', ')})`}` +
            (e.orderBy ? `; last day to order for delivery: ${e.orderBy}` : ''),
        ),
        'Use gift-oriented wording where it fits (gift for her, cozy gift, Christmas gift) while orders can still arrive in time. After an event’s last order day, do not promise delivery for it; suggest gift cards or “after the holidays” wording instead.',
      ].join('\n'),
    });
  }
  blocks.push({
    key: 'markets',
    auto: true,
    text: [
      `Markets: ${input.markets.map((m) => `${m.code} ${m.share}%`).join(', ')}.`,
      'Write in English for an international audience (US spelling). Give sizes in inches and centimetres, e.g. 18 x 18 in / 45 x 45 cm.',
      input.deliveryDays ? `Delivery takes about ${input.deliveryDays} days.` : '',
    ]
      .filter(Boolean)
      .join(' '),
  });
  if (input.salesPlatform === 'ETSY') {
    blocks.push({
      key: 'etsy_rules',
      auto: true,
      text: 'Etsy listing rules: the title is up to 140 characters, starts with the main search phrase, reads naturally — no keyword stuffing, no word repeated more than twice. Exactly 13 tags, each at most 20 characters, made of letters, digits and spaces, multi-word phrases buyers actually type; do not repeat the title word for word in every tag. The description opens with what the item is, its material, technique, size and use — the first 160 characters show in search results.',
    });
  }
  if (input.channel === 'pinterest') {
    blocks.push({
      key: 'pinterest_rules',
      auto: true,
      text: 'Pinterest pin rules: the title is up to 100 characters with the main keyword early; the description is up to 500 characters, natural sentences with 2–4 search phrases, ending with a call to action; at most 2 hashtags. Pins are searched like a visual search engine: describe what is seen and what it is for.',
    });
  }
  if (input.brand?.about) {
    blocks.push({
      key: 'brand',
      auto: true,
      text: [
        `About the brand: ${input.brand.about}`,
        input.brand.audience ? `Audience: ${input.brand.audience}` : '',
        input.brand.goal ? `Goal: ${input.brand.goal}` : '',
      ]
        .filter(Boolean)
        .join('\n'),
    });
  }
  if (input.pool.length || input.etsy.length) {
    blocks.push({
      key: 'research_data',
      auto: true,
      text: [
        'Research data (reliable; use these phrases, do not invent search volumes):',
        'Keyword pool — phrase | Pinterest growth month/year | uses among top Etsy listings | used by our products:',
        ...input.pool
          .slice(0, 30)
          .map(
            (p) =>
              `- ${p.phrase} | ${p.pinterest ? `${p.pinterest.mom ?? '?'}% / ${p.pinterest.yoy ?? '?'}%` : '—'} | ${p.etsy || '—'} | ${p.own || '—'}`,
          ),
        ...(input.tags?.length
          ? [
              'Rated tags — tag | active Etsy listings (competition) | average favourites of its top listings | score 0–100 (prefer high scores; very high competition alone is a weak tag):',
              ...input.tags
                .slice(0, 30)
                .map(
                  (t) =>
                    `- ${t.tag} | ${t.count} (${t.competition}) | ${t.avgFavorers} | ${t.score}`,
                ),
            ]
          : []),
        ...input.etsy.map(
          (m) =>
            `Etsy “${m.keyword}”: ${m.count} active listings` +
            (m.priceUsd
              ? `, USD prices ${m.priceUsd.min}–${m.priceUsd.max} (median ${m.priceUsd.median})`
              : '') +
            `; frequent tags: ${m.tags
              .slice(0, 12)
              .map((t) => t.tag)
              .join(', ')}.`,
        ),
      ].join('\n'),
    });
  }
  const off = new Set(input.context.off);
  return [
    ...blocks.map((b) => ({ ...b, enabled: !off.has(b.key) })),
    ...input.context.own.map((b) => ({ key: b.id, auto: false, enabled: b.enabled, text: b.text })),
  ];
}

export const ADVICE_INSTRUCTIONS = `You are an Etsy and Pinterest copywriter and SEO helper for a small handmade brand.
For the given product, propose: 3 title variants, 13 tags, an opening paragraph for the description, and 2 Pinterest pins (title + description) that lead to the listing.
Follow every rule in the context blocks. Use the research's keyword pool: prefer phrases backed by several sources and phrases growing now; keep what already works in the product. Be truthful to the product: never invent materials, sizes or features that are not in its data.
Each "why" is short, in the owner language, and cites the phrases or numbers it relies on.`;

/** The full instructions: the task, then the enabled blocks. */
export function adviceInstructions(blocks: ContextBlock[]): string {
  return [
    ADVICE_INSTRUCTIONS,
    ...blocks
      .filter((b) => b.enabled)
      .map((b) => `\n## ${b.auto ? b.key : 'owner note'}\n${b.text}`),
  ].join('\n');
}

/** The answer's JSON schema (strict). */
export const ADVICE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['titles', 'tags', 'tagsWhy', 'opening', 'openingWhy', 'pins'],
  properties: {
    titles: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'why'],
        properties: { title: { type: 'string' }, why: { type: 'string' } },
      },
    },
    tags: { type: 'array', items: { type: 'string' } },
    tagsWhy: { type: 'string' },
    opening: { type: 'string' },
    openingWhy: { type: 'string' },
    pins: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'description'],
        properties: { title: { type: 'string' }, description: { type: 'string' } },
      },
    },
  },
} as const;

export interface Advice {
  titles: { title: string; why: string }[];
  tags: string[];
  tagsWhy: string;
  opening: string;
  openingWhy: string;
  pins: { title: string; description: string }[];
}

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/** The answer, kept within sane bounds (the checks below say what breaks the rules). */
export function parseAdvice(data: unknown): Advice | null {
  const d = (data ?? {}) as Record<string, unknown>;
  const titles = (Array.isArray(d['titles']) ? d['titles'] : [])
    .map((t) => ({
      title: str((t as Record<string, unknown>)?.['title'], 300),
      why: str((t as Record<string, unknown>)?.['why'], 500),
    }))
    .filter((t) => t.title)
    .slice(0, 5);
  const tags = [
    ...new Set(
      (Array.isArray(d['tags']) ? d['tags'] : [])
        .map((t) => str(t, 60).toLowerCase())
        .filter(Boolean),
    ),
  ].slice(0, 20);
  const pins = (Array.isArray(d['pins']) ? d['pins'] : [])
    .map((p) => ({
      title: str((p as Record<string, unknown>)?.['title'], 200),
      description: str((p as Record<string, unknown>)?.['description'], 1000),
    }))
    .filter((p) => p.title)
    .slice(0, 3);
  if (!titles.length && !tags.length) return null;
  return {
    titles,
    tags,
    tagsWhy: str(d['tagsWhy'], 600),
    opening: str(d['opening'], 1500),
    openingWhy: str(d['openingWhy'], 600),
    pins,
  };
}

export type CheckIssue =
  | { code: 'titleLong'; index: number; length: number }
  | { code: 'titleRepeats'; index: number; word: string }
  | { code: 'tagsCount'; count: number }
  | { code: 'tagLong'; tag: string; length: number }
  | { code: 'tagChars'; tag: string }
  | { code: 'pinTitleLong'; index: number; length: number }
  | { code: 'pinDescriptionLong'; index: number; length: number };

/** Etsy's and Pinterest's limits, checked without the AI. */
export function checkAdvice(a: Advice): CheckIssue[] {
  const issues: CheckIssue[] = [];
  a.titles.forEach((t, index) => {
    if (t.title.length > 140) issues.push({ code: 'titleLong', index, length: t.title.length });
    const counts = new Map<string, number>();
    for (const w of t.title.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? [])
      counts.set(w, (counts.get(w) ?? 0) + 1);
    const repeated = [...counts].find(([, n]) => n > 2);
    if (repeated) issues.push({ code: 'titleRepeats', index, word: repeated[0] });
  });
  if (a.tags.length !== 13) issues.push({ code: 'tagsCount', count: a.tags.length });
  for (const tag of a.tags) {
    if (tag.length > 20) issues.push({ code: 'tagLong', tag, length: tag.length });
    else if (!/^[\p{L}\p{N} '’-]+$/u.test(tag)) issues.push({ code: 'tagChars', tag });
  }
  a.pins.forEach((p, index) => {
    if (p.title.length > 100) issues.push({ code: 'pinTitleLong', index, length: p.title.length });
    if (p.description.length > 500)
      issues.push({ code: 'pinDescriptionLong', index, length: p.description.length });
  });
  return issues;
}
