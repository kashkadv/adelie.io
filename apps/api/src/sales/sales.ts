// Pure sales helpers (ADR-0018). Unit-tested.

const DAY_MS = 86_400_000;
const day = (d: Date) => d.toISOString().slice(0, 10);

/**
 * What the shop earned from an order: what the buyer paid minus the sales tax (Etsy collects and
 * remits it — it is not the seller's money). Platform fees are not subtracted here.
 */
export function netRevenue(order: { total: number | null; tax: number | null }): number | null {
  if (order.total === null) return null;
  return order.total - (order.tax ?? 0);
}

/** Revenue and order count per UTC day over [from, to] (inclusive); days without orders are 0. */
export function ordersByDay(
  orders: { orderedAt: Date; total: number | null; tax: number | null }[],
  from: string,
  to: string,
): { date: string; revenue: number; orders: number }[] {
  const start = Date.parse(`${from}T00:00:00Z`);
  const days = Math.max(0, Math.round((Date.parse(`${to}T00:00:00Z`) - start) / DAY_MS) + 1);
  const out = Array.from({ length: days }, (_, i) => ({
    date: day(new Date(start + i * DAY_MS)),
    revenue: 0,
    orders: 0,
  }));
  for (const o of orders) {
    const i = Math.floor((o.orderedAt.getTime() - start) / DAY_MS);
    if (i < 0 || i >= days) continue;
    out[i]!.revenue += netRevenue(o) ?? 0;
    out[i]!.orders += 1;
  }
  return out;
}

interface SalesOrder {
  orderedAt: Date;
  currency: string;
  total: number | null;
  tax: number | null;
  country: string | null;
  units: number;
}
interface Window {
  from: string;
  to: string;
}
const inWindow = (o: SalesOrder, w: Window) => {
  const d = day(o.orderedAt);
  return d >= w.from && d <= w.to;
};

/**
 * The Overview of a point of sale (ADR-0018), in the main currency (the one with most orders;
 * others are never added in): orders, revenue, average order and units for the period vs the
 * previous one, revenue per day, and buyers' countries (top 3 + the rest).
 */
export function salesOverview(orders: SalesOrder[], current: Window, previous: Window) {
  const counts = new Map<string, number>();
  for (const o of orders) counts.set(o.currency, (counts.get(o.currency) ?? 0) + 1);
  const currency = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const mine = orders.filter((o) => o.currency === currency);
  const summary = (w: Window) => {
    const list = mine.filter((o) => inWindow(o, w));
    const revenue = list.reduce((n, o) => n + (netRevenue(o) ?? 0), 0);
    return {
      orders: list.length,
      revenue,
      average: list.length ? Math.round(revenue / list.length) : null,
      units: list.reduce((n, o) => n + o.units, 0),
    };
  };
  const now = summary(current);
  const before = summary(previous);
  const kpi = (id: 'orders' | 'revenue' | 'average' | 'units') => ({
    id,
    value: now[id],
    previous: before[id],
    status: 'READY' as const,
    coverage: 1,
  });

  const countries = new Map<string, number>();
  for (const o of mine.filter((x) => inWindow(x, current))) {
    const c = o.country ?? '';
    countries.set(c, (countries.get(c) ?? 0) + 1);
  }
  const ranked = [...countries].sort((a, b) => b[1] - a[1]);
  const rest = ranked.slice(3).reduce((n, [, v]) => n + v, 0);

  return {
    currency,
    kpis: [kpi('orders'), kpi('revenue'), kpi('average'), kpi('units')],
    series: ordersByDay(mine, current.from, current.to).map((d) => ({
      date: d.date,
      value: d.revenue,
      status: 'READY' as const,
    })),
    breakdown: [
      ...ranked.slice(0, 3).map(([key, value]) => ({ key, value })),
      ...(rest ? [{ key: 'other', value: rest }] : []),
    ],
  };
}
