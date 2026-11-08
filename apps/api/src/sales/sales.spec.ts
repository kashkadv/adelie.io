import { describe, expect, it } from 'vitest';
import { netRevenue, ordersByDay } from './sales.js';

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
