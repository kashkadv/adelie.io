// Post metrics over a period from sparse daily values (ADR-0013). Pure — unit-tested.

/**
 * Metrics with daily post values per platform: our metric key (metric_definition.key) → response
 * field. Pinterest reports them per day (ADR-0013); Instagram's come from snapshots (ADR-0017).
 */
export const PERIOD_METRICS: Record<string, Record<string, string>> = {
  PINTEREST: {
    impressions: 'impressions',
    saves: 'saves',
    pin_clicks: 'pinClicks',
    outbound_clicks: 'outboundClicks',
  },
  INSTAGRAM: {
    views: 'views',
    reach: 'reach',
    likes: 'likes',
    comments: 'comments',
    saves: 'saves',
    shares: 'shares',
  },
  // Lifetime totals only: daily values come from the day-to-day change of snapshots (ADR-0017).
  TIKTOK: {
    views: 'views',
    likes: 'likes',
    comments: 'comments',
    shares: 'shares',
  },
};
export type PeriodValues = Record<string, number>;

export interface PeriodPost {
  id: string;
  /** YYYY-MM-DD or null. */
  publishedAt: string | null;
  dailyFrom: string | null;
  dailyTo: string | null;
}

export interface PeriodResult {
  /** null = no daily data for this post yet (never 0 by assumption). */
  metrics: PeriodValues | null;
  /** The period starts before the post's daily data while the post already existed then. */
  partial: boolean;
}

/**
 * Sums of each post's daily values within [from, to]. Inside the post's covered days a missing
 * value is zero activity; a post that was never fetched has no data at all.
 */
export function periodMetrics(
  posts: PeriodPost[],
  sums: Map<string, PeriodValues>,
  from: string,
  fields: readonly string[],
): Map<string, PeriodResult> {
  const result = new Map<string, PeriodResult>();
  for (const p of posts) {
    if (!p.dailyFrom || !p.dailyTo) {
      result.set(p.id, { metrics: null, partial: false });
      continue;
    }
    const s = sums.get(p.id) ?? {};
    const existedBefore = p.publishedAt === null || p.publishedAt < p.dailyFrom;
    result.set(p.id, {
      metrics: Object.fromEntries(fields.map((f) => [f, s[f] ?? 0])),
      partial: from < p.dailyFrom && existedBefore,
    });
  }
  return result;
}

/** Order for a period sort: the metric descending, no data last, then newest first, then id. */
export function sortByPeriod(
  posts: PeriodPost[],
  values: Map<string, PeriodResult>,
  metric: string,
): PeriodPost[] {
  const value = (p: PeriodPost) => values.get(p.id)?.metrics?.[metric] ?? null;
  return [...posts].sort((a, b) => {
    const va = value(a);
    const vb = value(b);
    if (va !== vb) {
      if (va === null) return 1;
      if (vb === null) return -1;
      return vb - va;
    }
    if (a.publishedAt !== b.publishedAt) {
      if (!a.publishedAt) return 1;
      if (!b.publishedAt) return -1;
      return a.publishedAt < b.publishedAt ? 1 : -1;
    }
    return a.id < b.id ? -1 : 1;
  });
}
