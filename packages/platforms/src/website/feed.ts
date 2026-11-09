// A product feed in the Google Merchant format (RSS 2.0 + the `g:` namespace) — ADR-0021. Parsed
// by hand: feeds are flat lists of <item> with simple fields, and nothing here resolves entities
// or fetches anything, so a hostile feed cannot make the parser do work.
import { minorDigits } from '../etsy/mapping.js';
import type { Money, ProductData } from '../types.js';

/** A feed bigger than this is refused, not cut. */
export const MAX_FEED_ITEMS = 20_000;

export type FeedItem = Record<string, string>;

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decode(text: string): string {
  const cdata = /^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/.exec(text);
  if (cdata) return cdata[1]!.trim();
  return text
    .replace(/&#(\d+);/g, (_m, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, name: string) => ENTITIES[name.toLowerCase()] ?? m)
    .trim();
}

/** The items of a feed: each as { field → text }, the first value of a field winning. */
export function parseFeed(xml: string): FeedItem[] {
  const items: FeedItem[] = [];
  for (const block of xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)) {
    if (items.length >= MAX_FEED_ITEMS) throw new RangeError('The feed has too many items');
    const item: FeedItem = {};
    for (const field of block[1]!.matchAll(/<(g:)?([a-z_]+)\b[^>]*>([\s\S]*?)<\/\1\2>/gi)) {
      const key = field[2]!.toLowerCase();
      if (!(key in item)) item[key] = decode(field[3]!);
    }
    items.push(item);
  }
  return items;
}

/** "8400.00 UAH" → { amount: 840000, currency: 'UAH' } (minor units of its currency). */
export function parsePrice(text: string | undefined): Money | null {
  const m = /^\s*([\d\s.,]+?)\s*([A-Za-z]{3})\s*$/.exec(text ?? '');
  if (!m) return null;
  let number = m[1]!.replace(/\s/g, '');
  if (number.includes(',') && number.includes('.')) number = number.replace(/,/g, '');
  else number = number.replace(',', '.');
  const value = Number(number);
  if (!Number.isFinite(value) || value < 0) return null;
  const currency = m[2]!.toUpperCase();
  return { amount: Math.round(value * 10 ** minorDigits(currency)), currency };
}

/** Feed availability → the product state used by the shop products. */
function stateOf(availability: string | undefined): string {
  return /out[\s_-]*of[\s_-]*stock/i.test(availability ?? '') ? 'sold_out' : 'active';
}

/** One feed item as a catalogue product, or null when it has no id or title. */
export function mapFeedItem(item: FeedItem): ProductData | null {
  const id = item['id']?.trim();
  const title = item['title']?.trim();
  if (!id || !title) return null;
  return {
    externalId: id,
    title,
    url: item['link'] || undefined,
    imageUrl: item['image_link'] || undefined,
    state: stateOf(item['availability']),
    price: parsePrice(item['price']),
    quantity: null,
    views: null,
    favorers: null,
    tags: [],
    // The id is the article: what the product is matched to Etsy by.
    skus: [id],
    details: detailsOf(item),
    category: item['product_type']?.trim() || undefined,
  };
}

/** The feed fields worth showing on the product's card. */
function detailsOf(item: FeedItem): Record<string, string> {
  const pick = {
    description: item['description'],
    brand: item['brand'],
    productType: item['product_type'],
    availability: item['availability'],
    condition: item['condition'],
    groupId: item['item_group_id'],
  };
  return Object.fromEntries(Object.entries(pick).filter(([, v]) => !!v?.trim())) as Record<
    string,
    string
  >;
}
