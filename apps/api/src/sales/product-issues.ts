/**
 * Problems of a shop product, by how much they matter: `critical` (the product loses buyers or
 * sends them nowhere), `important` (worth fixing, nothing is broken) and `note` (look at it).
 * Everything is judged from what Adelie already stores — no extra platform requests.
 */
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
  | 'fewTags'
  | 'noViews';

export interface Issue {
  code: IssueCode;
  level: IssueLevel;
  /** Numbers and names the message quotes. */
  params?: Record<string, string | number>;
}

export interface IssueProduct {
  id: string;
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

/**
 * The article a SKU belongs to: "00011512/1" is the article "00011512" (what the website's
 * product is matched by, ADR-0021).
 */
export const baseSku = (sku: string): string => sku.split('/')[0]!;
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
  fewTags: 'note',
  noViews: 'note',
};

/** Issues of every product, by product id (products without any are absent). */
export function productIssues(
  products: IssueProduct[],
  now: Date = new Date(),
): Map<string, Issue[]> {
  const active = products.filter((p) => p.state === 'active');

  // The same SKU on several active listings: the link to the website would be ambiguous.
  const owners = new Map<string, Set<string>>();
  for (const p of active) {
    // By article: "0001" and "0001/1" in two listings point to one product on the website.
    for (const sku of p.skus) {
      owners.set(baseSku(sku), (owners.get(baseSku(sku)) ?? new Set<string>()).add(p.id));
    }
  }
  const result = new Map<string, Issue[]>();
  for (const p of products) {
    const codes: IssueCode[] = [];
    const params: Partial<Record<IssueCode, Issue['params']>> = {};
    if (p.state !== 'active') {
      if (p.posts > 0) codes.push('pinToUnavailable');
    } else {
      if (p.price === null || p.price <= 0) codes.push('noPrice');
      if (!p.imageUrl) codes.push('noPhoto');
      if (p.quantity === 0) codes.push('soldOutActive');
      if (p.skus.some((s) => (owners.get(baseSku(s))?.size ?? 0) > 1)) codes.push('duplicateSku');
      if (!p.skus.length) codes.push('noSku');
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
