/**
 * Problems of a shop product, by how much they matter: `critical` (the product loses buyers or
 * sends them nowhere), `important` (worth fixing, nothing is broken) and `note` (look at it).
 * Everything is judged from what Adelie already stores — no extra platform requests.
 */
import { baseSku } from '@adelie/platforms';

export type IssueLevel = 'critical' | 'important' | 'note';

export type IssueCode =
  | 'pinToUnavailable'
  | 'noPrice'
  | 'noPhoto'
  | 'soldOutActive'
  | 'duplicateSku'
  | 'noSku'
  | 'skuPattern'
  | 'noTags'
  | 'noPins'
  | 'skuGaps'
  | 'skuOneForAll'
  | 'twinMismatch'
  | 'notOnSite'
  | 'notOnEtsy'
  | 'fewTags'
  | 'noViews';

/** Every issue code, for validating what a client sends. */
export const ISSUE_CODES: readonly IssueCode[] = [
  'pinToUnavailable',
  'noPrice',
  'noPhoto',
  'soldOutActive',
  'duplicateSku',
  'noSku',
  'skuPattern',
  'noTags',
  'noPins',
  'skuGaps',
  'skuOneForAll',
  'twinMismatch',
  'notOnSite',
  'notOnEtsy',
  'fewTags',
  'noViews',
];

export interface Issue {
  code: IssueCode;
  level: IssueLevel;
  /** Numbers and names the message quotes. */
  params?: Record<string, string | number>;
}

export interface IssueProduct {
  id: string;
  /** ETSY (a shop) or WEBSITE (a site's feed): a site is judged by far fewer rules. */
  platform: string;
  /** The articles of its SKUs (a site product's `g:id`). */
  articles: string[];
  title: string;
  /** Listings of one group are the same product: not duplicates of each other. */
  twinGroupId: string | null;
  state: string;
  price: number | null;
  quantity: number | null;
  views: number | null;
  imageUrl: string | null;
  tags: string[];
  skus: string[];
  /** Live variations (inventory products); null = not read yet. */
  variationCount: number | null;
  /** Options the SKU goes by; empty = one SKU for the whole listing. */
  skuBy: string[];
  /** Names of the options the variations are made of. */
  variationOptions: string[];
  /** SKUs the product should have (one per combination of the `skuBy` options); null = unknown. */
  skuGroups: number | null;
  listedAt: Date | null;
  /** Posts (pins, captions) that lead to the product. */
  posts: number;
}

/** Etsy allows 13 tags: fewer is a missed chance to be found. */
/**
 * A SKU as the shop keeps them: a numeric code, optionally with a "/n" suffix for one more
 * variation of the same article ("00011512/1").
 */
const VALID_SKU = /^\d+(\/\d+)?$/;

export { baseSku };
const MAX_TAGS = 13;
/** A listing with no views at all this long after publishing is not being found. */
const NO_VIEWS_DAYS = 30;
const DAY_MS = 86_400_000;

const level: Record<IssueCode, IssueLevel> = {
  pinToUnavailable: 'critical',
  noPrice: 'critical',
  noPhoto: 'critical',
  soldOutActive: 'critical',
  duplicateSku: 'critical',
  noSku: 'important',
  skuPattern: 'important',
  noTags: 'important',
  noPins: 'important',
  skuGaps: 'important',
  skuOneForAll: 'important',
  twinMismatch: 'important',
  notOnSite: 'note',
  notOnEtsy: 'note',
  fewTags: 'note',
  noViews: 'note',
};

/** Issues of every product, by product id (products without any are absent). */
/**
 * The articles each channel has, to tell whether a product is also on the other channel; `null` =
 * the project has no such channel (nothing to compare with).
 */
export interface ChannelArticles {
  site: ReadonlySet<string> | null;
  etsy: ReadonlySet<string> | null;
}

export function productIssues(
  products: IssueProduct[],
  now: Date = new Date(),
  channels: ChannelArticles = { site: null, etsy: null },
): Map<string, Issue[]> {
  // Shop listings only: the same article on Etsy and on a site (or on two sites) is the point
  // of matching them, not a duplicate.
  const active = products.filter((p) => p.state === 'active' && p.platform !== 'WEBSITE');

  // The same SKU on several active listings: the link to the website would be ambiguous.
  // Twins (listings of one group) count as one owner.
  const owners = new Map<string, Set<string>>();
  for (const p of active) {
    // By article: "0001" and "0001/1" in two listings point to one product on the website.
    for (const sku of p.skus) {
      const key = baseSku(sku);
      owners.set(key, (owners.get(key) ?? new Set<string>()).add(p.twinGroupId ?? p.id));
    }
  }
  // Twins must agree: the same SKUs and the same price (they differ only in order or photos).
  const signature = (p: IssueProduct) => JSON.stringify([[...p.skus].sort(), p.price]);
  const twinsOf = new Map<string, IssueProduct[]>();
  for (const p of active) {
    if (p.twinGroupId) twinsOf.set(p.twinGroupId, [...(twinsOf.get(p.twinGroupId) ?? []), p]);
  }
  const result = new Map<string, Issue[]>();
  for (const p of products) {
    const codes: IssueCode[] = [];
    const params: Partial<Record<IssueCode, Issue['params']>> = {};
    if (p.platform === 'WEBSITE') {
      // A site's product: the feed is all we know. Is it also on Etsy?
      if (p.state === 'active') {
        if (p.price === null || p.price <= 0) codes.push('noPrice');
        if (!p.imageUrl) codes.push('noPhoto');
        if (channels.etsy && !p.articles.some((a) => channels.etsy!.has(a)))
          codes.push('notOnEtsy');
      }
    } else if (p.state !== 'active') {
      if (p.posts > 0) codes.push('pinToUnavailable');
    } else {
      if (p.price === null || p.price <= 0) codes.push('noPrice');
      if (!p.imageUrl) codes.push('noPhoto');
      if (p.quantity === 0) codes.push('soldOutActive');
      if (p.skus.some((s) => (owners.get(baseSku(s))?.size ?? 0) > 1)) codes.push('duplicateSku');
      const other = (p.twinGroupId ? (twinsOf.get(p.twinGroupId) ?? []) : []).find(
        (t) => t.id !== p.id && signature(t) !== signature(p),
      );
      if (other) {
        codes.push('twinMismatch');
        params['twinMismatch'] = { twin: other.title };
      }
      if (!p.skus.length) codes.push('noSku');
      // The article is not on the website (when the project has one).
      if (channels.site && p.articles.length && !p.articles.some((a) => channels.site!.has(a))) {
        codes.push('notOnSite');
      }
      // Our SKUs are numeric codes ("0040622", "0040622/1"); anything else (old schemes such as
      // "1896 AP_18/02/2021") is most likely a wrong one.
      const odd = p.skus.filter((sku) => !VALID_SKU.test(sku));
      if (odd.length) {
        codes.push('skuPattern');
        params['skuPattern'] = { skus: odd.join(', ') };
      }
      if (!p.tags.length) codes.push('noTags');
      // No pins, with or without sales: a product nobody is sent to has no traffic from there.
      if (p.posts === 0) codes.push('noPins');
      // Variations differ by two or more options, yet one SKU is set for all: most likely a
      // mistake (by one option it can be a choice — e.g. a vest that differs only by size).
      if (p.variationOptions.length >= 2 && !p.skuBy.length && p.skus.length) {
        codes.push('skuOneForAll');
        params['skuOneForAll'] = { options: p.variationOptions.join(', ') };
      }
      // The SKU goes by some options (colour…) but not every colour has a SKU of its own.
      if (
        p.skuBy.length &&
        p.skuGroups !== null &&
        p.skus.length > 0 &&
        p.skus.length < p.skuGroups
      ) {
        codes.push('skuGaps');
        params['skuGaps'] = { have: p.skus.length, groups: p.skuGroups, by: p.skuBy.join(', ') };
      }
      if (p.tags.length > 0 && p.tags.length < MAX_TAGS) codes.push('fewTags');
      if (
        p.views === 0 &&
        p.listedAt &&
        now.getTime() - p.listedAt.getTime() > NO_VIEWS_DAYS * DAY_MS
      ) {
        codes.push('noViews');
      }
    }
    if (codes.length) {
      result.set(
        p.id,
        codes.map((code) => ({
          code,
          level: level[code],
          ...(params[code] ? { params: params[code] } : {}),
        })),
      );
    }
  }
  return result;
}
