/**
 * The purchase a shop's server reports when a payment is confirmed (Flipper, ADR-0022). The body
 * follows GA4's Measurement Protocol (transaction_id, value, currency, items with item_id…), so an
 * existing GA4 call can be reused almost as it is. Pure functions, tested without a server.
 */
import { createHash, randomBytes } from 'node:crypto';
import { cleanProperties, USER_ID, type Properties } from './ingest.js';

const BASE62 = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const KEY_FORMAT = /^fls_[A-Za-z0-9]{32}$/;
const VISITOR = /^[0-9a-f]{32}$/;
const ORDER_ID = /^[\w.:/#-]{1,80}$/;
/** A payment may be confirmed hours later, by a webhook; older than this is refused. */
export const MAX_LATE_MS = 7 * 24 * 3600 * 1000;
const FUTURE_MS = 5 * 60 * 1000;

export const newServerKey = () =>
  `fls_${Array.from(randomBytes(32), (b) => BASE62[b % BASE62.length]).join('')}`;
/** Only the hash is stored: the key is shown once, like a password. */
export const hashServerKey = (key: string) => createHash('sha256').update(key).digest('hex');
export const isServerKey = (key: string) => KEY_FORMAT.test(key);

export interface ServerPurchase {
  orderId: string;
  occurredAt: Date;
  visitorId: string | null;
  /** The site's own id of the visitor (the opaque cookie value), if the shop passes it. */
  userId: string | null;
  url: string | null;
  properties: Properties;
}

export type ServerPurchaseResult =
  { ok: true; purchase: ServerPurchase } | { ok: false; error: string };

export function parseServerPurchase(body: unknown, now: Date = new Date()): ServerPurchaseResult {
  if (typeof body !== 'object' || body === null || Array.isArray(body))
    return { ok: false, error: 'body' };
  const b = body as Record<string, unknown>;

  const order = typeof b.transaction_id === 'number' ? String(b.transaction_id) : b.transaction_id;
  if (typeof order !== 'string' || !ORDER_ID.test(order))
    return { ok: false, error: 'transaction_id' };

  let occurredAt = now;
  if (b.occurred_at !== undefined) {
    const t = typeof b.occurred_at === 'string' ? new Date(b.occurred_at) : null;
    if (!t || Number.isNaN(t.getTime())) return { ok: false, error: 'occurred_at' };
    if (t.getTime() > now.getTime() + FUTURE_MS) return { ok: false, error: 'occurred_at' };
    if (now.getTime() - t.getTime() > MAX_LATE_MS) return { ok: false, error: 'too_old' };
    occurredAt = t;
  }

  const visitor =
    typeof b.visitor_id === 'string' && VISITOR.test(b.visitor_id) ? b.visitor_id : null;
  const props = cleanProperties({
    transaction_id: order,
    value: b.value,
    currency: typeof b.currency === 'string' ? b.currency.toUpperCase().slice(0, 3) : undefined,
    coupon: b.coupon,
    shipping: b.shipping,
    tax: b.tax,
    items: b.items,
  });
  if (!props) return { ok: false, error: 'body' };
  const items = props.items;
  if (Array.isArray(items))
    props.item_count = items.reduce(
      (n, i) => n + (typeof i.quantity === 'number' ? i.quantity : 1),
      0,
    );

  return {
    ok: true,
    purchase: {
      orderId: order,
      occurredAt,
      visitorId: visitor,
      userId: typeof b.user_id === 'string' && USER_ID.test(b.user_id) ? b.user_id : null,
      url: typeof b.url === 'string' ? b.url : null,
      properties: props,
    },
  };
}
