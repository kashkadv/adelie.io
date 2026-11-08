import { describe, expect, it } from 'vitest';
import {
  countsAsSale,
  monthlySales,
  moneyFlow,
  netRevenue,
  ordersByDay,
  salesOverview,
} from './sales.js';

describe('sales', () => {
  it('revenue leaves out the sales tax the platform remits', () => {
    expect(netRevenue({ total: 25920, tax: 1920 })).toBe(24000);
    expect(netRevenue({ total: 10000, tax: null })).toBe(10000);
    expect(netRevenue({ total: null, tax: 100 })).toBeNull();
  });

  it('revenue and orders per day, with empty days as zero', () => {
    const at = (iso: string) => new Date(iso);
    expect(
      ordersByDay(
        [
          { orderedAt: at('2026-10-02T10:00:00Z'), total: 1100, tax: 100 },
          { orderedAt: at('2026-10-02T23:59:00Z'), total: 500, tax: 0 },
          { orderedAt: at('2026-09-30T12:00:00Z'), total: 999, tax: 0 }, // before the period
        ],
        '2026-10-01',
        '2026-10-03',
      ),
    ).toEqual([
      { date: '2026-10-01', revenue: 0, orders: 0 },
      { date: '2026-10-02', revenue: 1500, orders: 2 },
      { date: '2026-10-03', revenue: 0, orders: 0 },
    ]);
  });
});

describe('salesOverview', () => {
  const order = (date: string, total: number, country = 'US', currency = 'USD') => ({
    orderedAt: new Date(`${date}T12:00:00Z`),
    currency,
    total,
    tax: 0,
    country,
    units: 1,
  });

  it('compares the period with the previous one in the main currency only', () => {
    const r = salesOverview(
      [
        order('2026-10-10', 1000),
        order('2026-10-11', 3000, 'DE'),
        order('2026-09-20', 2000),
        order('2026-10-12', 99999, 'GB', 'EUR'), // another currency: never added in
      ],
      { from: '2026-10-01', to: '2026-10-30' },
      { from: '2026-09-01', to: '2026-09-30' },
    );
    expect(r.currency).toBe('USD');
    expect(r.kpis.find((k) => k.id === 'revenue')).toMatchObject({ value: 4000, previous: 2000 });
    expect(r.kpis.find((k) => k.id === 'average')).toMatchObject({ value: 2000, previous: 2000 });
    expect(r.breakdown).toEqual([
      { key: 'US', value: 1 },
      { key: 'DE', value: 1 },
    ]);
    expect(r.series).toHaveLength(30);
  });
});

describe('moneyFlow', () => {
  it('sales from paid orders; refunds, fees, VAT and ads from the ledger; payouts left out', () => {
    const row = (category: string, amount: number) => ({ currency: 'USD', category, amount });
    const [usd] = moneyFlow(
      [
        row('sales', 364116), // replaced by the orders' sales
        row('tax', -24116),
        row('refund', -36500),
        row('transaction_fee', -19752),
        row('processing_fee', -19965),
        row('listing_fee', -7200),
        row('vat', -12157),
        row('ads', -13912),
        row('payout', -258606),
      ],
      new Map([['USD', 340000]]),
    );
    expect(usd).toMatchObject({
      sales: 340000,
      refunds: -36500,
      feesTotal: -59074,
      ads: -13912,
      net: 340000 - 36500 - 59074 - 13912,
    });
  });

  it('years before the ledger had payments: sales still come from the orders', () => {
    const [usd] = moneyFlow(
      [{ currency: 'USD', category: 'transaction_fee', amount: -500 }],
      new Map([['USD', 10000]]),
    );
    expect(usd).toMatchObject({ sales: 10000, net: 9500 });
  });
});

describe('monthlySales', () => {
  it('units and revenue per month, empty months as zero', () => {
    const line = (iso: string, quantity: number, price: number) => ({
      orderedAt: new Date(iso),
      quantity,
      price,
    });
    expect(
      monthlySales(
        [
          line('2026-10-03T10:00:00Z', 2, 1000),
          line('2026-08-31T23:00:00Z', 1, 500),
          line('2025-01-01T00:00:00Z', 9, 9),
        ],
        3,
        '2026-10-24',
      ),
    ).toEqual([
      { month: '2026-08-01', units: 1, revenue: 500 },
      { month: '2026-09-01', units: 0, revenue: 0 },
      { month: '2026-10-01', units: 2, revenue: 2000 },
    ]);
  });
});

describe('countsAsSale', () => {
  it('canceled and fully refunded orders are not sales', () => {
    expect(countsAsSale('Completed')).toBe(true);
    expect(countsAsSale('Partially Refunded')).toBe(true);
    expect(countsAsSale('Canceled')).toBe(false);
    expect(countsAsSale('Fully Refunded')).toBe(false);
    expect(countsAsSale(null)).toBe(true);
  });
});
