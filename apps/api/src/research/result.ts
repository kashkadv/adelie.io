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
  /** Both windows have enough days (before ≥ 3, after ≥ 14) and counted views: it enters the totals. */
  enough: boolean;
}

export interface GroupResult {
  products: number;
  /** How many of them enter the totals: the same products on both sides of the arrow. */
  counted: number;
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
  /** At least one changed product has enough days on both sides (before ≥ 3, after ≥ 14). */
  enough: boolean;
  /** When the first changed product with history before its change gets 14 days after; null if none will. */
  readyOn: string | null;
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

function group(all: ProductResult[]): GroupResult {
  const results = all.filter((r) => r.enough);
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
    products: all.length,
    counted: results.length,
    before,
    after,
    viewsChange: pct(before.viewsPerDay, after.viewsPerDay),
    favorersChange: pct(before.favorersPerDay, after.favorersPerDay),
  };
}

const MIN_BEFORE = 3;
const MIN_AFTER = 14;

/**
 * Before: up to 14 days before a product's first change (not before the history starts); after:
 * from the change to today, up to 28 days. Totals count only products with enough days on both
 * sides, so "before → after" is about the same products. Unchanged products are measured around
 * the median change day of the counted changed ones.
 */
export function researchResult(products: ProductInput[], today: string): ResearchResult {
  const historyStart = products.flatMap((p) => p.daily.map((d) => d.date)).sort()[0];
  const firstChange = (p: ProductInput) => p.changes.map((c) => c.date).sort()[0] ?? null;
  const changes = products.map(firstChange).filter((d): d is string => !!d);
  const since = [...changes].sort()[0] ?? null;

  const measure = (
    p: ProductInput,
    at: string,
  ): Pick<ProductResult, 'before' | 'after' | 'enough'> => {
    const start = [addDays(at, -14), historyStart ?? at].sort().at(-1)!;
    const end = [addDays(at, 28), today].sort()[0]!;
    const before = start < at ? window(p.daily, p.sales, start, at) : null;
    const after = at < end ? window(p.daily, p.sales, at, end) : null;
    const enough =
      !!before &&
      !!after &&
      before.days >= MIN_BEFORE &&
      after.days >= MIN_AFTER &&
      before.viewsPerDay !== null &&
      after.viewsPerDay !== null;
    return { before, after, enough };
  };

  const build = (p: ProductInput, at: string | null, changedOn: string | null): ProductResult => ({
    id: p.id,
    changedOn,
    fields: [...new Set(p.changes.flatMap((c) => c.fields))].sort(),
    ...(at ? measure(p, at) : { before: null, after: null, enough: false }),
  });

  const changedResults = products
    .filter((p) => firstChange(p))
    .map((p) => build(p, firstChange(p), firstChange(p)));
  const counted = changedResults
    .filter((r) => r.enough)
    .map((r) => r.changedOn!)
    .sort();
  const controlAt = counted.length ? counted[Math.floor(counted.length / 2)]! : since;
  const unchangedResults = products
    .filter((p) => !firstChange(p))
    .map((p) => build(p, controlAt, null));
  const byId = new Map([...changedResults, ...unchangedResults].map((r) => [r.id, r]));

  const daysBefore =
    since && historyStart ? Math.min(14, Math.max(0, between(historyStart, since))) : 0;
  const daysAfter = since ? Math.max(0, between(since, today)) : 0;
  const ready = changes
    .filter((d) => historyStart && between(historyStart, d) >= MIN_BEFORE)
    .map((d) => addDays(d, MIN_AFTER))
    .sort()[0];
  return {
    since,
    daysBefore,
    daysAfter,
    enough: counted.length > 0,
    readyOn: ready ?? null,
    changed: group(changedResults),
    unchanged: group(unchangedResults),
    products: products.map((p) => byId.get(p.id)!),
  };
}
