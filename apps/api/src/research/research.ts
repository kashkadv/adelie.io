// Niche research (ADR-0032): markets, Pinterest regions, what the Etsy market and Pinterest trends
// say about a niche, the keyword pool and the ranking of the studied products. Pure and
// unit-tested; the controller does the I/O. Only our own computations are kept — counts, shares,
// frequencies — never other sellers' listings (Etsy terms).

export interface Market {
  /** ISO country code. */
  code: string;
  /** Percent of orders. */
  share: number;
}

/** The project's markets from its orders' countries: shares of the top countries (min 2 %). */
export function marketsFromOrders(countries: (string | null)[]): Market[] {
  const counts = new Map<string, number>();
  for (const c of countries)
    if (c) counts.set(c.toUpperCase(), (counts.get(c.toUpperCase()) ?? 0) + 1);
  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  if (!total) return [{ code: 'US', share: 100 }];
  return [...counts]
    .map(([code, n]) => ({ code, share: Math.round((n / total) * 100) }))
    .filter((m) => m.share >= 2)
    .sort((a, b) => b.share - a.share)
    .slice(0, 10);
}

/** Markets from the client: known two-letter codes, shares 0–100. */
export function parseMarkets(raw: unknown): Market[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 20) return null;
  const out: Market[] = [];
  for (const m of raw) {
    const code = typeof m?.code === 'string' ? m.code.toUpperCase() : '';
    const share = typeof m?.share === 'number' ? Math.round(m.share) : NaN;
    if (!/^[A-Z]{2}$/.test(code) || !(share >= 0 && share <= 100)) return null;
    if (!out.some((x) => x.code === code)) out.push({ code, share });
  }
  return out;
}

/** Pinterest Trends regions and the countries each covers (docs/specs/pebble.md, PoC 0). */
const REGIONS: [string, string[]][] = [
  ['US', ['US']],
  ['CA', ['CA']],
  ['GB+IE', ['GB', 'IE']],
  ['AU+NZ', ['AU', 'NZ']],
  ['DE+AT+CH', ['DE', 'AT', 'CH']],
  ['FR', ['FR']],
  ['NL+BE+LU', ['NL', 'BE', 'LU']],
  ['SE+DK+FI+NO', ['SE', 'DK', 'FI', 'NO']],
  ['PL+RO+HU+SK+CZ', ['PL', 'RO', 'HU', 'SK', 'CZ']],
  ['IT+ES+PT+GR+MT', ['IT', 'ES', 'PT', 'GR', 'MT']],
  ['MX+AR+CO+CL', ['MX', 'AR', 'CO', 'CL']],
  ['BR', ['BR']],
];

/** The Pinterest regions that cover most of the markets, with their weight (sum of shares). */
export function pinterestRegions(markets: Market[], max = 3): { region: string; weight: number }[] {
  return REGIONS.map(([region, countries]) => ({
    region,
    weight: markets.filter((m) => countries.includes(m.code)).reduce((n, m) => n + m.share, 0),
  }))
    .filter((r) => r.weight > 0)
    .sort((a, b) => b.weight - a.weight)
    .slice(0, max);
}

// --- Text -------------------------------------------------------------------------------------

const STOP = new Set(
  'a an and the for of to in on with by from at or your my our this that is are be it as cm inch inches x'.split(
    ' ',
  ),
);
/**
 * Words of a text: lower case, letters and digits, simple plurals folded ("pillows" → "pillow";
 * "christmas", "cushions'" stems like "-as", "-is", "-us", "-ss" are left alone).
 */
export function words(text: string): string[] {
  return (text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])
    .filter((w) => w.length > 1 && !STOP.has(w) && !/^\d+$/.test(w))
    .map((w) => (w.length > 3 && /[^aisu]s$/.test(w) ? w.slice(0, -1) : w));
}
/** A phrase as its folded words joined, for comparing phrases ("Wool Pillows" = "wool pillow"). */
export const phraseKey = (phrase: string) => words(phrase).join(' ');

/** Does a text contain every word of a phrase? */
export function mentions(text: string, phrase: string): boolean {
  const have = new Set(words(text));
  const need = words(phrase);
  return need.length > 0 && need.every((w) => have.has(w));
}

// --- Etsy market --------------------------------------------------------------------------------

export interface EtsyListingLite {
  title: string;
  tags: string[];
  price: { amount: number; divisor: number; currency_code: string } | null;
  num_favorers: number;
}

export interface EtsyMarket {
  keyword: string;
  /** Active listings matching the phrase. */
  count: number;
  /** Prices of the USD listings among the top 100 (other currencies are not converted). */
  priceUsd: { min: number; median: number; max: number; listings: number } | null;
  avgFavorers: number;
  /** Tags of the top listings, by how many use them. */
  tags: { tag: string; n: number }[];
  /** Two-word phrases in the top listings' titles, by how many use them. */
  titlePhrases: { phrase: string; n: number }[];
}

const median = (v: number[]) => {
  const s = [...v].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

/** What the top Etsy listings for a phrase have in common — our computation, not the listings. */
export function etsyMarket(
  keyword: string,
  count: number,
  listings: EtsyListingLite[],
): EtsyMarket {
  const usd = listings
    .filter((l) => l.price?.currency_code === 'USD' && l.price.divisor > 0)
    .map((l) => l.price!.amount / l.price!.divisor);
  const tagCount = new Map<string, number>();
  const phraseCount = new Map<string, number>();
  for (const l of listings) {
    for (const tag of new Set(l.tags.map((t) => t.toLowerCase().trim()).filter(Boolean))) {
      tagCount.set(tag, (tagCount.get(tag) ?? 0) + 1);
    }
    const w = words(l.title);
    const pairs = new Set(w.slice(1).map((x, i) => `${w[i]} ${x}`));
    for (const p of pairs) phraseCount.set(p, (phraseCount.get(p) ?? 0) + 1);
  }
  const top = <K extends string>(m: Map<string, number>, key: K, min: number) =>
    [...m]
      .filter(([, n]) => n >= min)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 40)
      .map(([k, n]) => ({ [key]: k, n }) as Record<K, string> & { n: number });
  return {
    keyword,
    count,
    priceUsd: usd.length
      ? {
          min: Math.round(Math.min(...usd)),
          median: Math.round(median(usd)),
          max: Math.round(Math.max(...usd)),
          listings: usd.length,
        }
      : null,
    avgFavorers: listings.length
      ? Math.round(listings.reduce((n, l) => n + (l.num_favorers ?? 0), 0) / listings.length)
      : 0,
    tags: top(tagCount, 'tag', 2),
    titlePhrases: top(phraseCount, 'phrase', 3),
  };
}

// --- Pinterest trends ---------------------------------------------------------------------------

export interface TrendKeyword {
  keyword: string;
  region: string;
  /** Growth in percent, week / month / year over the previous; 10001 = from nothing. */
  wow: number | null;
  mom: number | null;
  yoy: number | null;
  /** The ISO week start (YYYY-MM-DD) of the keyword's peak in the last 52 weeks. */
  peak: string | null;
  /** The last 12 weekly values (0–100, relative to the keyword's own peak). */
  recent: number[];
}

/** Reads a Trends API answer for a region. */
export function readTrends(region: string, body: unknown): TrendKeyword[] {
  const trends = (body as { trends?: unknown[] } | null)?.trends;
  if (!Array.isArray(trends)) return [];
  return trends.flatMap((t) => {
    const k = t as {
      keyword?: string;
      pct_growth_wow?: number;
      pct_growth_mom?: number;
      pct_growth_yoy?: number;
      time_series?: Record<string, number>;
    };
    if (!k.keyword) return [];
    const series = Object.entries(k.time_series ?? {}).sort(([a], [b]) => (a < b ? -1 : 1));
    const peak = series.reduce<[string, number] | null>(
      (best, cur) => (!best || cur[1] > best[1] ? cur : best),
      null,
    );
    const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
    return [
      {
        keyword: k.keyword.toLowerCase(),
        region,
        wow: num(k.pct_growth_wow),
        mom: num(k.pct_growth_mom),
        yoy: num(k.pct_growth_yoy),
        peak: peak ? peak[0] : null,
        recent: series.slice(-12).map(([, v]) => v),
      },
    ];
  });
}

// --- Pool and ranking ---------------------------------------------------------------------------

export interface PoolPhrase {
  phrase: string;
  /** Pinterest: the best month-over-month growth among regions, and where it was seen. */
  pinterest: {
    mom: number | null;
    yoy: number | null;
    regions: string[];
    peak: string | null;
  } | null;
  /** Etsy: how many of the top listings use it as a tag or in the title (of 100 per phrase). */
  etsy: number;
  /** Your products of the research that already use it. */
  own: number;
  score: number;
}

const growthScore = (g: number | null) =>
  g === null ? 0 : g >= 10000 ? 2 : Math.max(-1, Math.min(2, g / 100));

/**
 * The keyword pool: phrases trending on Pinterest, frequent in the Etsy market, used by your own
 * products — scored by how many sources back them and how they grow.
 */
export function keywordPool(
  trends: TrendKeyword[],
  markets: EtsyMarket[],
  ownTexts: string[],
): PoolPhrase[] {
  const pool = new Map<string, PoolPhrase>();
  const get = (phrase: string) => {
    const key = phraseKey(phrase);
    if (!key) return null;
    let p = pool.get(key);
    if (!p) {
      p = { phrase: key, pinterest: null, etsy: 0, own: 0, score: 0 };
      pool.set(key, p);
    }
    return p;
  };
  for (const t of trends) {
    const p = get(t.keyword);
    if (!p) continue;
    const prev = p.pinterest;
    p.pinterest = {
      mom:
        prev?.mom === null || prev?.mom === undefined
          ? t.mom
          : Math.max(prev.mom, t.mom ?? -Infinity),
      yoy:
        prev?.yoy === null || prev?.yoy === undefined
          ? t.yoy
          : Math.max(prev.yoy, t.yoy ?? -Infinity),
      regions: [...new Set([...(prev?.regions ?? []), t.region])],
      peak: prev?.peak ?? t.peak,
    };
  }
  for (const m of markets) {
    for (const t of m.tags) {
      const p = get(t.tag);
      if (p) p.etsy += t.n;
    }
    for (const t of m.titlePhrases) {
      const p = get(t.phrase);
      if (p) p.etsy += t.n;
    }
  }
  for (const p of pool.values()) {
    p.own = ownTexts.filter((text) => mentions(text, p.phrase)).length;
    p.score =
      Math.round(
        ((p.pinterest ? 1 + growthScore(p.pinterest.mom) : 0) +
          Math.min(3, p.etsy / 15) +
          (p.own > 0 ? 0.5 : 0)) *
          10,
      ) / 10;
  }
  return [...pool.values()]
    .filter((p) => p.pinterest || p.etsy >= 3)
    .sort((a, b) => b.score - a.score)
    .slice(0, 80);
}

export interface StudiedProduct {
  id: string;
  title: string;
  tags: string[];
  views: number | null;
  favorers: number | null;
  sold12m: number;
}

export interface RankedProduct {
  id: string;
  score: number;
  /** Pool phrases the product already uses (title or tags). */
  matched: string[];
  /** Strong pool phrases it does not use yet. */
  missing: string[];
  reasons: ('sells' | 'liked' | 'viewed' | 'trending' | 'noTags' | 'fewTags' | 'shortTitle')[];
}

/**
 * The studied products ranked for promotion: demand (pool phrases they match, the trending ones
 * weigh more), proof (sales, favourites, views among the studied) and readiness (tags, title).
 */
export function rankProducts(products: StudiedProduct[], pool: PoolPhrase[]): RankedProduct[] {
  const strong = pool.slice(0, 30);
  const maxOf = (f: (p: StudiedProduct) => number) => Math.max(1, ...products.map(f));
  const maxSold = maxOf((p) => p.sold12m);
  const maxFav = maxOf((p) => p.favorers ?? 0);
  const maxViews = maxOf((p) => p.views ?? 0);
  return products
    .map((p) => {
      const text = `${p.title} ${p.tags.join(' ')}`;
      const matched = strong.filter((s) => mentions(text, s.phrase));
      const demand = matched.reduce((n, s) => n + s.score, 0);
      const trending = matched.some((s) => (s.pinterest?.mom ?? 0) > 20);
      const proof =
        (p.sold12m / maxSold) * 3 + ((p.favorers ?? 0) / maxFav) * 1.5 + (p.views ?? 0) / maxViews;
      const reasons: RankedProduct['reasons'] = [];
      if (p.sold12m > 0) reasons.push('sells');
      if ((p.favorers ?? 0) >= maxFav * 0.5 && (p.favorers ?? 0) > 0) reasons.push('liked');
      if ((p.views ?? 0) >= maxViews * 0.5 && (p.views ?? 0) > 0) reasons.push('viewed');
      if (trending) reasons.push('trending');
      if (p.tags.length === 0) reasons.push('noTags');
      else if (p.tags.length < 13) reasons.push('fewTags');
      if (p.title.length < 60) reasons.push('shortTitle');
      return {
        id: p.id,
        score: Math.round((Math.min(5, demand / 3) + proof) * 10) / 10,
        matched: matched.map((s) => s.phrase),
        missing: strong
          .filter((s) => !matched.includes(s) && s.own === 0)
          .slice(0, 8)
          .map((s) => s.phrase),
        reasons,
      };
    })
    .sort((a, b) => b.score - a.score);
}

/** Catalogue products that belong to a niche: their title, tags or category mention a phrase. */
export function suggestProducts<
  T extends { title: string; tags: string[]; category: string | null },
>(catalogue: T[], keywords: string[], max = 40): T[] {
  return catalogue
    .filter((p) =>
      keywords.some((k) => mentions(`${p.title} ${p.tags.join(' ')} ${p.category ?? ''}`, k)),
    )
    .slice(0, max);
}

/** Words too general to define a niche on their own ("cover" matches playlist covers too). */
const GENERIC = new Set(
  'cover case set kit decor idea gift style design handmade diy aesthetic cute small large'.split(
    ' ',
  ),
);

/** The niche's own words: the seed phrases' words without the general ones. */
export function nicheWords(keywords: string[]): Set<string> {
  return new Set(keywords.flatMap(words).filter((w) => !GENERIC.has(w)));
}

/** The words Trends filters by: the last specific word of each seed phrase ("wool pillow cover" → "pillow"). */
export function trendFilters(keywords: string[]): string[] {
  return [
    ...new Set(
      keywords
        .map((k) =>
          words(k)
            .filter((w) => !GENERIC.has(w))
            .at(-1),
        )
        .filter((w): w is string => !!w),
    ),
  ].slice(0, 5);
}

/** Keeps the trend keywords that share a specific word with the niche. */
export function relevantTrends(trends: TrendKeyword[], keywords: string[]): TrendKeyword[] {
  const niche = nicheWords(keywords);
  return trends.filter((t) => words(t.keyword).some((w) => niche.has(w)));
}
