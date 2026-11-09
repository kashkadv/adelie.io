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
  | 'noTags'
  | 'noPins'
  | 'sharedSku'
  | 'fewTags'
  | 'skuFormat'
  | 'noViews';

export interface Issue {
  code: IssueCode;
  level: IssueLevel;
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
  listedAt: Date | null;
  /** Posts (pins, captions) that lead to the product. */
  posts: number;
}

/** Etsy allows 13 tags: fewer is a missed chance to be found. */
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
  noTags: 'important',
  noPins: 'important',
  sharedSku: 'important',
  fewTags: 'note',
  skuFormat: 'note',
  noViews: 'note',
};

const digitsOnly = (sku: string) => /^\d+$/.test(sku);

/** Issues of every product, by product id (products without any are absent). */
export function productIssues(
  products: IssueProduct[],
  now: Date = new Date(),
): Map<string, Issue[]> {
  const active = products.filter((p) => p.state === 'active');

  // The same SKU on several active listings: the link to the website would be ambiguous.
  const owners = new Map<string, Set<string>>();
  for (const p of active) {
    for (const sku of p.skus) owners.set(sku, (owners.get(sku) ?? new Set<string>()).add(p.id));
  }
  // Numeric SKUs are padded with zeros in this shop ("00037012"): one without them stands out
  // (a number that lost its zeros on the way is what breaks matching with the website).
  const numeric = active.flatMap((p) => p.skus).filter(digitsOnly);
  const padded =
    numeric.length > 0 && numeric.filter((s) => s.startsWith('0')).length > numeric.length / 2;

  const result = new Map<string, Issue[]>();
  for (const p of products) {
    const codes: IssueCode[] = [];
    if (p.state !== 'active') {
      if (p.posts > 0) codes.push('pinToUnavailable');
    } else {
      if (p.price === null || p.price <= 0) codes.push('noPrice');
      if (!p.imageUrl) codes.push('noPhoto');
      if (p.quantity === 0) codes.push('soldOutActive');
      if (p.skus.some((s) => (owners.get(s)?.size ?? 0) > 1)) codes.push('duplicateSku');
      if (!p.skus.length) codes.push('noSku');
      if (!p.tags.length) codes.push('noTags');
      // No pins, with or without sales: a product nobody is sent to has no traffic from there.
      if (p.posts === 0) codes.push('noPins');
      if ((p.variationCount ?? 0) > 1 && p.skus.length === 1) codes.push('sharedSku');
      if (p.tags.length > 0 && p.tags.length < MAX_TAGS) codes.push('fewTags');
      if (padded && p.skus.some((s) => digitsOnly(s) && !s.startsWith('0')))
        codes.push('skuFormat');
      if (
        p.views === 0 &&
        p.listedAt &&
        now.getTime() - p.listedAt.getTime() > NO_VIEWS_DAYS * DAY_MS
      ) {
        codes.push('noViews');
      }
    }
    if (codes.length)
      result.set(
        p.id,
        codes.map((code) => ({ code, level: level[code] })),
      );
  }
  return result;
}
