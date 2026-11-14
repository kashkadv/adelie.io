// The result of a research (ADR-0036): what changed products did before and after their changes,
// against the unchanged ones over the same days (the season lifts both). Counters are cumulative,
// so the activity of a window is the growth between its first and last known day. Pure and
// unit-tested.

const DAY = 86_400_000;
const dayOf = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (day: string, n: number) =>
  dayOf(new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY));
const between = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / DAY);

export interface DailyPoint {
  date: string;
  views: number | null;
  favorers: number | null;
}

export interface Window {
  from: string;
  to: string;
  days: number;
  viewsPerDay: number | null;
  favorersPerDay: number | null;
  sales: number;
}

/** Growth per day of a cumulative counter between the known days nearest to a window's ends. */
function perDay(points: DailyPoint[], key: 'views' | 'favorers', from: string, to: string) {
  const known = points.filter((p) => p[key] !== null && p.date >= from && p.date <= to);
  if (known.length < 2) return null;
  const first = known[0]!;
  const last = known[known.length - 1]!;
  const days = between(first.date, last.date);
  return days > 0 ? (last[key]! - first[key]!) / days : null;
}

function window(
  points: DailyPoint[],
  sales: { date: string; quantity: number }[],
  from: string,
  to: string,
): Window {
  return {
    from,
    to,
    days: Math.max(0, between(from, to)),
    viewsPerDay: perDay(points, 'views', from, to),
    favorersPerDay: perDay(points, 'favorers', from, to),
    sales: sales.filter((s) => s.date >= from && s.date < to).reduce((n, s) => n + s.quantity, 0),
  };
}

export interface ProductInput {
  id: string;
  daily: DailyPoint[];
  /** Applied changes from the editor: when, and which fields. */
  changes: { date: string; fields: string[] }[];
  sales: { date: string; quantity: number }[];
}

export interface ProductResult {
  id: string;
  changedOn: string | null;
  fields: string[];
  before: Window | null;
  after: Window | null;
}

export interface GroupResult {
  products: number;
  before: { viewsPerDay: number | null; favorersPerDay: number | null; sales: number };
  after: { viewsPerDay: number | null; favorersPerDay: number | null; sales: number };
  /** Change of views per day, after against before, in percent. */
  viewsChange: number | null;
  favorersChange: number | null;
}

export interface ResearchResult {
  /** The first change among the products (the control group is measured from it too). */
  since: string | null;
  daysBefore: number;
  daysAfter: number;
  /** Enough days after the changes to say anything (≥ 14) and some before (≥ 3). */
  enough: boolean;
  changed: GroupResult;
  unchanged: GroupResult;
  products: ProductResult[];
}

const sum = (v: (number | null)[]) =>
  v.some((x) => x !== null) ? v.reduce<number>((n, x) => n + (x ?? 0), 0) : null;
const pct = (before: number | null, after: number | null) =>
  before === null || after === null || before <= 0
    ? null
    : Math.round(((after - before) / before) * 100);

function group(results: ProductResult[]): GroupResult {
  const before = {
    viewsPerDay: sum(results.map((r) => r.before?.viewsPerDay ?? null)),
    favorersPerDay: sum(results.map((r) => r.before?.favorersPerDay ?? null)),
    sales: results.reduce((n, r) => n + (r.before?.sales ?? 0), 0),
  };
  const after = {
    viewsPerDay: sum(results.map((r) => r.after?.viewsPerDay ?? null)),
    favorersPerDay: sum(results.map((r) => r.after?.favorersPerDay ?? null)),
    sales: results.reduce((n, r) => n + (r.after?.sales ?? 0), 0),
  };
  return {
    products: results.length,
    before,
    after,
    viewsChange: pct(before.viewsPerDay, after.viewsPerDay),
    favorersChange: pct(before.favorersPerDay, after.favorersPerDay),
  };
}

/**
 * Before: up to 14 days before a product's first change (not before the history starts); after:
 * from the change to today, up to 28 days. Unchanged products are measured over the same days as
 * the first change of the group.
 */
export function researchResult(products: ProductInput[], today: string): ResearchResult {
  const historyStart = products.flatMap((p) => p.daily.map((d) => d.date)).sort()[0];
  const firstChange = (p: ProductInput) => p.changes.map((c) => c.date).sort()[0] ?? null;
  const since =
    products
      .map(firstChange)
      .filter((d): d is string => !!d)
      .sort()[0] ?? null;

  const measure = (p: ProductInput, at: string): Pick<ProductResult, 'before' | 'after'> => {
    const start = [addDays(at, -14), historyStart ?? at].sort().at(-1)!;
    const end = [addDays(at, 28), today].sort()[0]!;
    return {
      before: start < at ? window(p.daily, p.sales, start, at) : null,
      after: at < end ? window(p.daily, p.sales, at, end) : null,
    };
  };

  const results: ProductResult[] = products.map((p) => {
    const changedOn = firstChange(p);
    const at = changedOn ?? since;
    return {
      id: p.id,
      changedOn,
      fields: [...new Set(p.changes.flatMap((c) => c.fields))].sort(),
      ...(at ? measure(p, at) : { before: null, after: null }),
    };
  });
  const changed = results.filter((r) => r.changedOn);
  const unchanged = results.filter((r) => !r.changedOn);
  const daysBefore =
    since && historyStart ? Math.min(14, Math.max(0, between(historyStart, since))) : 0;
  const daysAfter = since ? Math.max(0, between(since, today)) : 0;
  return {
    since,
    daysBefore,
    daysAfter,
    enough: daysAfter >= 14 && daysBefore >= 3,
    changed: group(changed),
    unchanged: group(unchanged),
    products: results,
  };
}
