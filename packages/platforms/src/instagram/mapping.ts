// Pure mapping from Instagram (Graph API, Unified login) responses to the adapter contract (ADR-0011).
// Shapes confirmed in the PoC on adelie.if (docs/integrations/instagram.md, 2026-11-07).
import type { AccountData, DataStatus, MetricPoint, PostContentType, PostData } from '../types.js';

export interface InstagramUser {
  id: string;
  username?: string;
  name?: string;
  profile_picture_url?: string;
  followers_count?: number;
  follows_count?: number;
  media_count?: number;
}

export interface InstagramInsight {
  name: string;
  period?: string;
  values?: { value?: number | null; end_time?: string }[];
  total_value?: { value?: number | null };
}

export interface InstagramMedia {
  id: string;
  caption?: string;
  media_type?: string;
  media_product_type?: string;
  permalink?: string;
  media_url?: string;
  thumbnail_url?: string;
  timestamp?: string;
  insights?: { data?: InstagramInsight[] };
}

/** Meta finalizes insights within ~48 hours: younger days are preliminary (PROCESSING). */
const SETTLE_DAYS = 2;

const DAY_MS = 86_400_000;
const dayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export function countOrNull(value: number | null | undefined): number | null {
  return typeof value === 'number' && value >= 0 ? value : null;
}

/** READY once the day is older than the settle window, PROCESSING before. */
export function statusFor(date: string, today: string): DataStatus {
  const age = (Date.parse(today) - Date.parse(date)) / DAY_MS;
  return age >= SETTLE_DAYS ? 'READY' : 'PROCESSING';
}

export function mapAccount(raw: InstagramUser, today: string): AccountData {
  const followers = countOrNull(raw.followers_count);
  return {
    externalId: raw.id,
    username: raw.username,
    displayName: raw.name || raw.username,
    avatarUrl: raw.profile_picture_url,
    accountType: 'BUSINESS',
    followersCount: followers,
    followingCount: countOrNull(raw.follows_count),
    postsCount: countOrNull(raw.media_count),
    metrics: [
      {
        providerKey: 'followers_count',
        scope: 'ACCOUNT',
        date: today,
        value: followers,
        dataStatus: followers === null ? 'UNAVAILABLE' : 'READY',
      },
    ],
  };
}

const CONTENT_TYPES: Record<string, PostContentType> = {
  IMAGE: 'IMAGE',
  VIDEO: 'VIDEO',
  CAROUSEL_ALBUM: 'CAROUSEL',
};

export function mapMedia(raw: InstagramMedia): PostData {
  const caption = raw.caption?.trim();
  return {
    externalId: raw.id,
    url: raw.permalink,
    contentType: CONTENT_TYPES[raw.media_type ?? ''] ?? 'OTHER',
    // Instagram has no titles: the first line of the caption stands in for one.
    title: caption ? caption.split('\n')[0]!.slice(0, 120) : undefined,
    description: caption || undefined,
    // Videos (Reels) have a thumbnail; images and carousels show their media URL.
    thumbnailUrl: raw.thumbnail_url ?? raw.media_url,
    publishedAt: raw.timestamp ? new Date(raw.timestamp) : undefined,
    isOwn: true,
  };
}

/**
 * Meta counts `views` only for media created after 2 July 2024 (when it replaced impressions); older
 * media report 0 — that is "not tracked", not zero views (Gushka, 2026-11-07: every pre-July-2024
 * image/carousel had 0).
 */
export const VIEWS_TRACKED_SINCE = '2024-07-02';

/** Lifetime post metrics that came with the media page (nested `insights` field). */
export function mapMediaInsights(raw: InstagramMedia, today: string): MetricPoint[] {
  const untrackedViews = !!raw.timestamp && raw.timestamp.slice(0, 10) < VIEWS_TRACKED_SINCE;
  return (raw.insights?.data ?? []).map((m) => {
    const reported = countOrNull(m.values?.[0]?.value);
    const value = m.name === 'views' && reported === 0 && untrackedViews ? null : reported;
    return {
      providerKey: m.name,
      scope: 'POST' as const,
      postExternalId: raw.id,
      date: today,
      value,
      dataStatus: value === null ? ('UNAVAILABLE' as const) : ('READY' as const),
    };
  });
}

/**
 * Daily account series (`metric_type=time_series`). Each `end_time` closes a day in Meta's account
 * time zone (07:00 UTC = midnight Pacific): the value belongs to the day before it.
 */
export function mapTimeSeries(data: InstagramInsight[], today: string): MetricPoint[] {
  return data.flatMap((m) =>
    (m.values ?? []).flatMap((v) => {
      if (!v.end_time) return [];
      const date = dayOf(Date.parse(v.end_time) - DAY_MS);
      return [
        {
          providerKey: m.name,
          scope: 'ACCOUNT' as const,
          date,
          value: countOrNull(v.value),
          dataStatus: statusFor(date, today),
        },
      ];
    }),
  );
}

/** One day of `metric_type=total_value` metrics (requested day by day). */
export function mapDayTotals(data: InstagramInsight[], date: string, today: string): MetricPoint[] {
  return data.map((m) => ({
    providerKey: m.name,
    scope: 'ACCOUNT' as const,
    date,
    value: countOrNull(m.total_value?.value),
    dataStatus: statusFor(date, today),
  }));
}

/** Inclusive YYYY-MM-DD days from `from` to `to`. */
export function daysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let t = Date.parse(from); t <= Date.parse(to); t += DAY_MS) out.push(dayOf(t));
  return out;
}

/** Splits [from, to] into chunks of at most `size` days (the API allows 30 days per request). */
export function chunkDays(from: string, to: string, size = 30): { from: string; to: string }[] {
  const days = daysBetween(from, to);
  const out: { from: string; to: string }[] = [];
  for (let i = 0; i < days.length; i += size) {
    const part = days.slice(i, i + size);
    out.push({ from: part[0]!, to: part[part.length - 1]! });
  }
  return out;
}

export const nextDay = (date: string) => dayOf(Date.parse(date) + DAY_MS);
