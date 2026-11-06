// Overview aggregation (ADR-0008 rules): pure functions over stored metric values. Unit-tested.
// - DAILY counts are summed over days; days without data are skipped, never counted as 0.
// - SNAPSHOT metrics (followers) take the latest value at or before the period end, per account.
// - The status of an aggregate is the worst status among its parts.

export type DataStatus = 'READY' | 'PROCESSING' | 'ESTIMATE' | 'UNAVAILABLE';

export interface StoredValue {
  accountId: string;
  key: string;
  /** YYYY-MM-DD */
  date: string;
  dimensionKey: string;
  value: number | null;
  dataStatus: DataStatus;
}

export interface Period {
  from: string;
  to: string;
  days: number;
}

export interface MetricSummary {
  /** null = no data in the period (not zero). */
  value: number | null;
  previous: number | null;
  status: DataStatus;
  /** Days with data / days in the period (DAILY metrics). */
  coverage: number;
}

const RANK: Record<DataStatus, number> = { READY: 0, PROCESSING: 1, ESTIMATE: 2, UNAVAILABLE: 3 };
const worst = (a: DataStatus, b: DataStatus): DataStatus => (RANK[b] > RANK[a] ? b : a);

const addDays = (yyyyMmDd: string, n: number) => {
  const d = new Date(`${yyyyMmDd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** The last `days` days ending today (UTC), and the same-length period right before it. */
export function periods(days: number, today: string): { current: Period; previous: Period } {
  const from = addDays(today, -(days - 1));
  return {
    current: { from, to: today, days },
    previous: { from: addDays(from, -days), to: addDays(from, -1), days },
  };
}

export function datesOf(p: Period): string[] {
  return Array.from({ length: p.days }, (_, i) => addDays(p.from, i));
}

const inPeriod = (date: string, p: Period) => date >= p.from && date <= p.to;

/** Sum of a DAILY metric (totals, no breakdown) over a period. */
function sumDaily(values: StoredValue[], key: string, p: Period) {
  let sum = 0;
  let status: DataStatus = 'READY';
  const daysWithData = new Set<string>();
  for (const v of values) {
    if (v.key !== key || v.dimensionKey !== '' || !inPeriod(v.date, p)) continue;
    if (v.value === null) continue;
    sum += v.value;
    status = worst(status, v.dataStatus);
    daysWithData.add(v.date);
  }
  return daysWithData.size ? { value: sum, status, days: daysWithData.size } : null;
}

export function dailyMetric(
  values: StoredValue[],
  key: string,
  current: Period,
  previous: Period,
): MetricSummary {
  const now = sumDaily(values, key, current);
  const before = sumDaily(values, key, previous);
  return {
    value: now?.value ?? null,
    previous: before?.value ?? null,
    status: now?.status ?? 'UNAVAILABLE',
    coverage: now ? now.days / current.days : 0,
  };
}

/** Latest snapshot per account at or before `date`, summed over accounts; null if none. */
function snapshotAt(values: StoredValue[], key: string, date: string): number | null {
  const latest = new Map<string, StoredValue>();
  for (const v of values) {
    if (v.key !== key || v.dimensionKey !== '' || v.date > date || v.value === null) continue;
    const seen = latest.get(v.accountId);
    if (!seen || v.date > seen.date) latest.set(v.accountId, v);
  }
  if (!latest.size) return null;
  return [...latest.values()].reduce((s, v) => s + (v.value ?? 0), 0);
}

export function snapshotMetric(
  values: StoredValue[],
  key: string,
  current: Period,
  previous: Period,
): MetricSummary {
  const value = snapshotAt(values, key, current.to);
  return {
    value,
    previous: snapshotAt(values, key, previous.to),
    status: value === null ? 'UNAVAILABLE' : 'READY',
    coverage: value === null ? 0 : 1,
  };
}

/** Daily series of a metric (totals) for the chart: null where no account has data that day. */
export function dailySeries(
  values: StoredValue[],
  key: string,
  p: Period,
): { date: string; value: number | null; status: DataStatus }[] {
  const byDate = new Map<string, { value: number; status: DataStatus }>();
  for (const v of values) {
    if (v.key !== key || v.dimensionKey !== '' || !inPeriod(v.date, p) || v.value === null)
      continue;
    const day = byDate.get(v.date);
    byDate.set(v.date, {
      value: (day?.value ?? 0) + v.value,
      status: worst(day?.status ?? 'READY', v.dataStatus),
    });
  }
  return datesOf(p).map((date) => {
    const day = byDate.get(date);
    return day ? { date, ...day } : { date, value: null, status: 'UNAVAILABLE' as const };
  });
}

/** Breakdown of a metric over a dimension (e.g. app_type) for the period, largest first. */
export function breakdown(
  values: StoredValue[],
  key: string,
  dimension: string,
  p: Period,
): { key: string; value: number }[] {
  const totals = new Map<string, number>();
  const prefix = `${dimension}=`;
  for (const v of values) {
    if (
      v.key !== key ||
      !v.dimensionKey.startsWith(prefix) ||
      !inPeriod(v.date, p) ||
      v.value === null
    )
      continue;
    const k = v.dimensionKey.slice(prefix.length);
    totals.set(k, (totals.get(k) ?? 0) + v.value);
  }
  return [...totals.entries()]
    .map(([k, value]) => ({ key: k, value }))
    .sort((a, b) => b.value - a.value);
}
