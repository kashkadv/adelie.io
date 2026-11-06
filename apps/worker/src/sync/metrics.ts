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
