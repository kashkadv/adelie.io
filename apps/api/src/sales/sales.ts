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
