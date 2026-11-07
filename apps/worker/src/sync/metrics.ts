// Pure helpers for storing metric points (ADR-0008). Unit-tested.
import type { DataStatus, MetricPoint } from '@adelie/platforms';

/** Canonical dimension key: sorted "k=v" pairs joined by "&"; '' = totals. */
export function dimensionKey(dimensions?: Record<string, string>): string {
  if (!dimensions) return '';
  return Object.keys(dimensions)
    .sort()
    .map((k) => `${k}=${dimensions[k]}`)
    .join('&');
}

/** Post snapshots are written only when something changed (ADR-0008). */
export function snapshotChanged(
  previous: { value: number | null; dataStatus: DataStatus } | undefined,
  point: Pick<MetricPoint, 'value' | 'dataStatus'>,
): boolean {
  return !previous || previous.value !== point.value || previous.dataStatus !== point.dataStatus;
}

/** Severity order: the status of an aggregate is the worst among its parts. */
const STATUS_RANK: Record<DataStatus, number> = {
  READY: 0,
  PROCESSING: 1,
  ESTIMATE: 2,
  UNAVAILABLE: 3,
};

export function worstStatus(statuses: DataStatus[]): DataStatus {
  return statuses.reduce<DataStatus>(
    (worst, s) => (STATUS_RANK[s] > STATUS_RANK[worst] ? s : worst),
    'READY',
  );
}

/** Our metric key → column of PostMetricsLatest. */
const LATEST_COLUMNS = {
  impressions: 'impressions',
  saves: 'saves',
  pin_clicks: 'pinClicks',
  outbound_clicks: 'outboundClicks',
  engagements: 'engagements',
  video_views: 'videoViews',
  engagement_rate: 'engagementRate',
  views: 'views',
  reach: 'reach',
  likes: 'likes',
  comments: 'comments',
  shares: 'shares',
} as const;

type LatestColumn = (typeof LATEST_COLUMNS)[keyof typeof LATEST_COLUMNS];

export type LatestRow = { [K in LatestColumn]: number | null } & {
  dataStatus: DataStatus;
  asOfDate: string;
};

/** Builds the wide PostMetricsLatest row from a post's latest snapshot per metric. */
export function latestRow(
  latest: { key: string; value: number | null; dataStatus: DataStatus; date: string }[],
): LatestRow | null {
  const known = latest.filter((m) => m.key in LATEST_COLUMNS);
  if (known.length === 0) return null;
  const row: LatestRow = {
    impressions: null,
    saves: null,
    pinClicks: null,
    outboundClicks: null,
    engagements: null,
    videoViews: null,
    engagementRate: null,
    views: null,
    reach: null,
    likes: null,
    comments: null,
    shares: null,
    dataStatus: worstStatus(known.map((m) => m.dataStatus)),
    asOfDate: known.reduce((max, m) => (m.date > max ? m.date : max), known[0]!.date),
  };
  for (const m of known) {
    const column = LATEST_COLUMNS[m.key as keyof typeof LATEST_COLUMNS];
    // Counts are integers; rates stay fractional.
    row[column] = m.value === null || column === 'engagementRate' ? m.value : Math.round(m.value);
  }
  return row;
}

const addDays = (yyyyMmDd: string, n: number) => {
  const d = new Date(`${yyyyMmDd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** How many recent days are re-fetched for an active post: late-arriving and PROCESSING days. */
export const DAILY_REFRESH_DAYS = 7;

/**
 * Which days of a post's daily metrics to fetch (ADR-0013), or null when none:
 * - never fetched → its whole history the platform allows (from publication);
 * - its lifetime totals changed, or recent days are not final → the last week, and any gap;
 * - otherwise nothing: no new activity, so the covered range just extends to today.
 */
export function dailyFetchWindow(
  post: { publishedAt: string | null; dailyTo: string | null },
  opts: { today: string; historyDays: number; changed: boolean; pending: boolean },
): { from: string; to: string } | null {
  const earliest = addDays(opts.today, -(opts.historyDays - 1));
  const clamp = (d: string) => (d < earliest ? earliest : d);
  if (!post.dailyTo) {
    return { from: clamp(post.publishedAt ?? earliest), to: opts.today };
  }
  if (!opts.changed && !opts.pending) return null;
  return { from: clamp(addDays(post.dailyTo, -(DAILY_REFRESH_DAYS - 1))), to: opts.today };
}

/**
 * Activity since the previous snapshot (ADR-0017), or null when there is nothing to compare with:
 * no earlier value (a post seen for the first time is only a baseline — unless it was published
 * after the previous sync, when all its activity is new) or a value that is not a number.
 */
export function snapshotDelta(
  previous: number | null | undefined,
  next: number | null,
  newPost: boolean,
): number | null {
  if (next === null) return null;
  if (previous === undefined) return newPost ? next : null;
  if (previous === null) return null;
  return next - previous;
}

/**
 * The day a delta between two syncs belongs to: the daily sync runs after midnight UTC, so its
 * change is mostly yesterday's activity — but never a day before what the post already covers or
 * its baseline (a second sync on the same day continues that day).
 */
export function deltaDay(today: string, floor: string | null): string {
  const yesterday = addDays(today, -1);
  return floor && floor > yesterday ? floor : yesterday;
}
