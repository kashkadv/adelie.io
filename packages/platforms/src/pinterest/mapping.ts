// Pure mapping from Pinterest API v5 responses to the adapter contract (ADR-0011).
// Shapes follow the official OpenAPI spec and PoC 1 (docs/integrations/pinterest.md).
// Confirmed on real data in PoC 2 (Gushka, 2026-11-06): `pin_metrics` has `90d` and `lifetime_metrics`
// with lowercase keys (impression, save, pin_click, outbound_click, comment, reaction, video_views…)
// plus non-metric fields such as `last_updated`; `split_field=APP_TYPE` returns `web`/`mobile`/`tablet`.
import type {
  AccountData,
  BoardData,
  DataStatus,
  MetricPoint,
  PostContentType,
  PostData,
} from '../types.js';

export interface PinterestUserAccount {
  id?: string;
  username?: string;
  business_name?: string;
  account_type?: string;
  profile_image?: string;
  follower_count?: number;
  following_count?: number;
  pin_count?: number;
  monthly_views?: number;
}

export interface PinterestBoard {
  id: string;
  name: string;
  description?: string | null;
  privacy?: string;
  pin_count?: number;
  media?: { image_cover_url?: string | null } | null;
}

export interface PinterestPin {
  id: string;
  created_at?: string;
  link?: string | null;
  title?: string | null;
  description?: string | null;
  board_id?: string;
  /** false for pins saved from other accounts (they also carry parent_pin_id and have no metrics). */
  is_owner?: boolean;
  creative_type?: string | null;
  media?: {
    media_type?: string;
    images?: Record<string, { url?: string }>;
    cover_image_url?: string;
  } | null;
  pin_metrics?: Record<string, Record<string, number | string | null> | null> | null;
}

export interface PinterestDailyMetric {
  date: string;
  data_status?: string;
  metrics?: Record<string, number | null>;
}

export type PinterestAnalyticsResponse = Record<
  string,
  { daily_metrics?: PinterestDailyMetric[] } | undefined
>;

/** Pinterest uses -1 for "not available"; negative or missing counts are never 0 — they are null. */
export function count(value: number | null | undefined): number | null {
  return typeof value === 'number' && value >= 0 ? value : null;
}

/** READY/PROCESSING/ESTIMATE pass through; BEFORE_* and other statuses mean no data. */
export function dataStatus(status: string | undefined): { status: DataStatus; provider?: string } {
  if (status === 'READY' || status === 'PROCESSING' || status === 'ESTIMATE') {
    return { status, provider: status };
  }
  return { status: 'UNAVAILABLE', provider: status };
}

export function mapAccount(raw: PinterestUserAccount, today: string): AccountData {
  const externalId = raw.id ?? raw.username;
  if (!externalId) throw new Error('Pinterest user_account has neither id nor username');
  const monthlyViews = count(raw.monthly_views);
  return {
    externalId,
    username: raw.username,
    displayName: raw.business_name || raw.username,
    avatarUrl: raw.profile_image,
    accountType: raw.account_type,
    followersCount: count(raw.follower_count),
    followingCount: count(raw.following_count),
    postsCount: count(raw.pin_count),
    metrics: [
      snapshot('follower_count', count(raw.follower_count), today),
      snapshot('monthly_views', monthlyViews, today),
    ],
  };
}

function snapshot(providerKey: string, value: number | null, today: string): MetricPoint {
  return {
    providerKey,
    scope: 'ACCOUNT',
    date: today,
    value,
    dataStatus: value === null ? 'UNAVAILABLE' : 'READY',
  };
}

export function mapBoard(raw: PinterestBoard): BoardData {
  return {
    externalId: raw.id,
    name: raw.name,
    description: raw.description ?? undefined,
    privacy: raw.privacy,
    pinCount: count(raw.pin_count) ?? undefined,
    coverUrl: raw.media?.image_cover_url ?? undefined,
  };
}

export function contentType(pin: PinterestPin): PostContentType {
  const creative = pin.creative_type?.toUpperCase();
  const media = pin.media?.media_type?.toLowerCase();
  if (creative && ['SHOPPING', 'SHOP_THE_PIN', 'COLLECTION'].includes(creative)) return 'PRODUCT';
  if (creative === 'CAROUSEL' || media === 'multiple_images' || media === 'multiple_mixed') {
    return 'CAROUSEL';
  }
  if (creative === 'VIDEO' || creative === 'MAX_VIDEO' || media === 'video') return 'VIDEO';
  if (media === 'image' || creative === 'REGULAR') return 'IMAGE';
  return 'OTHER';
}

function thumbnail(pin: PinterestPin): string | undefined {
  const images = pin.media?.images;
  return (
    images?.['600x']?.url ??
    images?.['400x300']?.url ??
    pin.media?.cover_image_url ??
    Object.values(images ?? {})[0]?.url
  );
}

export function mapPin(raw: PinterestPin): PostData {
  return {
    externalId: raw.id,
    url: `https://www.pinterest.com/pin/${raw.id}/`,
    contentType: contentType(raw),
    title: raw.title || undefined,
    description: raw.description || undefined,
    thumbnailUrl: thumbnail(raw),
    publishedAt: raw.created_at ? new Date(raw.created_at) : undefined,
    boardExternalId: raw.board_id,
    link: raw.link || undefined,
    isOwn: raw.is_owner !== false,
  };
}

/** pin_metrics keys → provider keys used in the metric catalogue (aliases for older names). */
const PIN_METRIC_ALIASES: Record<string, string> = {
  CLICKTHROUGH: 'OUTBOUND_CLICK',
};

/**
 * Lifetime pin metrics → POST metric snapshots dated today. Only `lifetime_metrics` is used:
 * the 90-day window would double-count against daily account data.
 */
export function mapPinMetrics(raw: PinterestPin, today: string): MetricPoint[] {
  const lifetime = raw.pin_metrics?.['lifetime_metrics'];
  if (!lifetime) return [];
  return (
    Object.entries(lifetime)
      // Metrics are numbers (or null); fields like `last_updated` (a timestamp) are not metrics.
      .filter(
        (entry): entry is [string, number | null] =>
          entry[1] === null || typeof entry[1] === 'number',
      )
      .map(([key, value]) => {
        const upper = key.toUpperCase();
        const v = count(value);
        return {
          providerKey: PIN_METRIC_ALIASES[upper] ?? upper,
          scope: 'POST',
          postExternalId: raw.id,
          date: today,
          value: v,
          dataStatus: v === null ? 'UNAVAILABLE' : 'READY',
        } satisfies MetricPoint;
      })
  );
}

/**
 * /user_account/analytics → ACCOUNT metric points. The "all" key holds totals; any other top-level
 * key is a breakdown value of `dimension` (e.g. MOBILE / WEB with split_field=APP_TYPE).
 */
export function mapAccountAnalytics(
  raw: PinterestAnalyticsResponse,
  dimension?: string,
): MetricPoint[] {
  const points: MetricPoint[] = [];
  for (const [group, data] of Object.entries(raw)) {
    const dimensions =
      group.toLowerCase() === 'all' || !dimension
        ? undefined
        : { [dimension]: group.toUpperCase() };
    if (dimension && !dimensions) continue; // with a split, totals come from the unsplit request
    for (const day of data?.daily_metrics ?? []) {
      const { status, provider } = dataStatus(day.data_status);
      for (const [key, value] of Object.entries(day.metrics ?? {})) {
        const v =
          status === 'UNAVAILABLE' ? null : typeof value === 'number' && value >= 0 ? value : null;
        points.push({
          providerKey: key,
          scope: 'ACCOUNT',
          date: day.date,
          value: v,
          dataStatus: v === null && status !== 'UNAVAILABLE' ? 'UNAVAILABLE' : status,
          providerStatus: provider,
          ...(dimensions ? { dimensions } : {}),
        });
      }
    }
  }
  return points;
}

/**
 * /pins/{id}/analytics → daily POST metric points. Same response shape as the account analytics
 * ("all" → daily_metrics); the keys are the platform's (IMPRESSION, SAVE, …).
 */
export function mapPinAnalytics(
  raw: PinterestAnalyticsResponse,
  postExternalId: string,
): MetricPoint[] {
  return mapAccountAnalytics(raw).map((p) => ({ ...p, scope: 'POST' as const, postExternalId }));
}
