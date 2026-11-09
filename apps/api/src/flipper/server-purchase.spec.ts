import { describe, expect, it } from 'vitest';
import {
  hashServerKey,
  isServerKey,
  newServerKey,
  parseServerPurchase,
} from './server-purchase.js';

const now = new Date('2026-11-10T12:00:00Z');
const ok = (body: unknown) => {
  const r = parseServerPurchase(body, now);
  if (!r.ok) throw new Error(r.error);
  return r.purchase;
};

describe('server keys', () => {
  it('are random, recognisable and stored only as a hash', () => {
    const a = newServerKey();
    expect(isServerKey(a)).toBe(true);
    expect(newServerKey()).not.toBe(a);
    expect(hashServerKey(a)).toMatch(/^[0-9a-f]{64}$/);
    expect(isServerKey('fls_short')).toBe(false);
  });
});

describe('parseServerPurchase', () => {
  it('takes a GA4-like body', () => {
    const p = ok({
      transaction_id: 'ORD-1',
      value: 580,
      currency: 'uah',
      shipping: 50,
      visitor_id: 'a'.repeat(32),
      items: [{ item_id: '00022502', item_name: 'Rug', price: 290, quantity: 2 }],
    });
    expect(p.orderId).toBe('ORD-1');
    expect(p.visitorId).toBe('a'.repeat(32));
    expect(p.occurredAt).toEqual(now);
    expect(p.properties).toMatchObject({
      value: 580,
      currency: 'UAH',
      shipping: 50,
      item_count: 2,
    });
    expect(p.properties.items).toEqual([
      { item_id: '00022502', item_name: 'Rug', price: 290, quantity: 2 },
    ]);
  });

  it('keeps the original payment time of a late confirmation', () => {
    const p = ok({ transaction_id: '7', occurred_at: '2026-11-08T09:00:00Z' });
    expect(p.occurredAt.toISOString()).toBe('2026-11-08T09:00:00.000Z');
  });

  it('refuses a missing order, a bad time, a time too old or in the future', () => {
    const err = (b: unknown) => (parseServerPurchase(b, now) as { error: string }).error;
    expect(err({ value: 1 })).toBe('transaction_id');
    expect(err({ transaction_id: 'x y' })).toBe('transaction_id');
    expect(err({ transaction_id: '1', occurred_at: 'soon' })).toBe('occurred_at');
    expect(err({ transaction_id: '1', occurred_at: '2026-11-10T13:00:00Z' })).toBe('occurred_at');
    expect(err({ transaction_id: '1', occurred_at: '2026-10-01T00:00:00Z' })).toBe('too_old');
    expect(err(null)).toBe('body');
  });

  it('ignores a malformed visitor id', () => {
    expect(ok({ transaction_id: '1', visitor_id: 'nope' }).visitorId).toBeNull();
  });
});
