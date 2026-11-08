// Pure mapping from Etsy Open API v3 responses to the adapter contract (ADR-0011, ADR-0018).
// Shapes from the public-data PoC (docs/specs/pebble.md, 2026-11-08) and the v3 reference.
import type { AccountData, Money, OrderData, ProductData } from '../types.js';

/** Etsy money: `amount / divisor` in `currency_code`. */
export interface EtsyMoney {
  amount?: number;
  divisor?: number;
  currency_code?: string;
}

export interface EtsyShop {
  shop_id: number;
  shop_name?: string;
  title?: string | null;
  url?: string;
  icon_url_fullxfull?: string | null;
  currency_code?: string;
  transaction_sold_count?: number;
  num_favorers?: number;
  review_count?: number | null;
  listing_active_count?: number;
}

export interface EtsyListing {
  listing_id: number;
  title?: string;
  url?: string;
  state?: string;
  price?: EtsyMoney;
  quantity?: number;
  views?: number;
  num_favorers?: number;
  tags?: string[];
  original_creation_timestamp?: number;
  created_timestamp?: number;
  images?: { url_570xN?: string; url_fullxfull?: string }[];
}

export interface EtsyTransaction {
  transaction_id: number;
  listing_id?: number | null;
  title?: string | null;
  quantity?: number;
  price?: EtsyMoney;
}

/** A receipt. Buyer name, email and address exist in the response but are deliberately not mapped. */
export interface EtsyReceipt {
  receipt_id: number;
  status?: string;
  is_paid?: boolean;
  is_shipped?: boolean;
  create_timestamp?: number;
  created_timestamp?: number;
  grandtotal?: EtsyMoney;
  subtotal?: EtsyMoney;
  total_shipping_cost?: EtsyMoney;
  total_tax_cost?: EtsyMoney;
  discount_amt?: EtsyMoney;
  country_iso?: string | null;
  transactions?: EtsyTransaction[];
}

/** Etsy returns titles HTML-escaped (`20&quot; x 20&quot;`). */
export function unescapeHtml(text: string): string {
  return text
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

const count = (v: number | null | undefined): number | null =>
  typeof v === 'number' && v >= 0 ? v : null;

/** Digits after the decimal point of a currency (USD 2, JPY 0); 2 when unknown. */
function minorDigits(currency: string): number {
  try {
    return (
      new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions()
        .maximumFractionDigits ?? 2
    );
  } catch {
    return 2;
  }
}

/** Etsy money → integer minor units of its currency. */
export function money(raw: EtsyMoney | null | undefined): Money | null {
  if (!raw || typeof raw.amount !== 'number' || !raw.divisor || !raw.currency_code) return null;
  const amount = Math.round((raw.amount / raw.divisor) * 10 ** minorDigits(raw.currency_code));
  return { amount, currency: raw.currency_code };
}

const seconds = (ts: number | undefined) => (ts ? new Date(ts * 1000) : undefined);

export function mapShop(raw: EtsyShop, today: string): AccountData {
  const snapshot = (providerKey: string, value: number | null) => ({
    providerKey,
    scope: 'ACCOUNT' as const,
    date: today,
    value,
    dataStatus: value === null ? ('UNAVAILABLE' as const) : ('READY' as const),
  });
  return {
    externalId: String(raw.shop_id),
    username: raw.shop_name,
    displayName: raw.shop_name,
    avatarUrl: raw.icon_url_fullxfull ?? undefined,
    accountType: 'SHOP',
    followersCount: count(raw.num_favorers),
    followingCount: null,
    postsCount: count(raw.listing_active_count),
    metrics: [
      snapshot('transaction_sold_count', count(raw.transaction_sold_count)),
      snapshot('num_favorers', count(raw.num_favorers)),
      snapshot('review_count', count(raw.review_count)),
      snapshot('listing_active_count', count(raw.listing_active_count)),
    ],
  };
}

export function mapListing(raw: EtsyListing): ProductData {
  return {
    externalId: String(raw.listing_id),
    title: unescapeHtml(raw.title?.trim() || String(raw.listing_id)),
    url: raw.url,
    imageUrl: raw.images?.[0]?.url_570xN ?? raw.images?.[0]?.url_fullxfull,
    state: raw.state ?? 'active',
    price: money(raw.price),
    quantity: count(raw.quantity),
    views: count(raw.views),
    favorers: count(raw.num_favorers),
    tags: raw.tags ?? [],
    listedAt: seconds(raw.original_creation_timestamp ?? raw.created_timestamp),
  };
}

export function mapReceipt(raw: EtsyReceipt): OrderData {
  const total = money(raw.grandtotal);
  const amount = (m: EtsyMoney | undefined) => money(m)?.amount ?? null;
  return {
    externalId: String(raw.receipt_id),
    orderedAt: seconds(raw.create_timestamp ?? raw.created_timestamp) ?? new Date(0),
    status: raw.status,
    isPaid: raw.is_paid,
    isShipped: raw.is_shipped,
    currency: total?.currency ?? raw.subtotal?.currency_code ?? 'USD',
    total: total?.amount ?? null,
    subtotal: amount(raw.subtotal),
    shipping: amount(raw.total_shipping_cost),
    tax: amount(raw.total_tax_cost),
    discount: amount(raw.discount_amt),
    country: raw.country_iso ?? undefined,
    items: (raw.transactions ?? []).map((t) => ({
      externalId: String(t.transaction_id),
      productExternalId: t.listing_id ? String(t.listing_id) : undefined,
      title: t.title ? unescapeHtml(t.title) : undefined,
      quantity: t.quantity ?? 1,
      price: money(t.price),
    })),
  };
}
