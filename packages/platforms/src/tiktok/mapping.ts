// Pure mapping from TikTok (Login Kit + Display API v2) responses to the adapter contract (ADR-0011,
// ADR-0023). Read-only. The Display API gives lifetime totals only, so daily values of a video come
// from the day-to-day change of snapshots (ADR-0017), like Instagram's.
import type { AccountData, MetricPoint, PostData } from '../types.js';

export interface TiktokUser {
  open_id: string;
  union_id?: string;
  avatar_url?: string;
  avatar_url_100?: string;
  avatar_large_url?: string;
  display_name?: string;
  bio_description?: string;
  profile_deep_link?: string;
  is_verified?: boolean;
  username?: string;
  follower_count?: number;
  following_count?: number;
  likes_count?: number;
  video_count?: number;
}

export interface TiktokVideo {
  id: string;
  title?: string;
  video_description?: string;
  /** Unix seconds. */
  create_time?: number;
  cover_image_url?: string;
  share_url?: string;
  duration?: number;
  view_count?: number;
  like_count?: number;
  comment_count?: number;
  share_count?: number;
}

/** What the sync requests: by scope, so a connection without some scope still gets the rest. */
export const TIKTOK_USER_FIELDS_BASIC =
  'open_id,union_id,avatar_url,avatar_url_100,avatar_large_url,display_name';
export const TIKTOK_USER_FIELDS_ALL = `${TIKTOK_USER_FIELDS_BASIC},bio_description,profile_deep_link,is_verified,username,follower_count,following_count,likes_count,video_count`;
export const TIKTOK_VIDEO_FIELDS =
  'id,title,video_description,create_time,cover_image_url,share_url,duration,like_count,comment_count,share_count,view_count';

/** A count, or null when the platform did not report it (never 0 by assumption). */
export function countOrNull(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
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

export function mapAccount(raw: TiktokUser, today: string): AccountData {
  const followers = countOrNull(raw.follower_count);
  const likes = countOrNull(raw.likes_count);
  const videos = countOrNull(raw.video_count);
  return {
    externalId: raw.open_id,
    username: raw.username || undefined,
    displayName: raw.display_name || raw.username || undefined,
    avatarUrl: raw.avatar_large_url ?? raw.avatar_url_100 ?? raw.avatar_url,
    followersCount: followers,
    followingCount: countOrNull(raw.following_count),
    postsCount: videos,
    metrics: [
      snapshot('follower_count', followers, today),
      snapshot('likes_count', likes, today),
      snapshot('video_count', videos, today),
    ],
  };
}

/** The address of a video without the tracking parameters TikTok adds to share links. */
export function cleanShareUrl(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    return `${url.origin}${url.pathname}`;
  } catch {
    return raw;
  }
}

export function mapVideo(raw: TiktokVideo): PostData {
  const description = raw.video_description?.trim();
  const title = raw.title?.trim() || (description ? description.split('\n')[0]!.slice(0, 120) : '');
  return {
    externalId: raw.id,
    url: cleanShareUrl(raw.share_url),
    contentType: 'VIDEO',
    title: title || undefined,
    description: description || undefined,
    // The cover address is signed and expires within hours: it is refreshed with every sync.
    thumbnailUrl: raw.cover_image_url,
    publishedAt: typeof raw.create_time === 'number' ? new Date(raw.create_time * 1000) : undefined,
    isOwn: true,
  };
}

const VIDEO_METRICS = ['view_count', 'like_count', 'comment_count', 'share_count'] as const;

/** Lifetime counters of a video, as snapshot points dated today. */
export function mapVideoMetrics(raw: TiktokVideo, today: string): MetricPoint[] {
  return VIDEO_METRICS.map((key) => {
    const value = countOrNull(raw[key]);
    return {
      providerKey: key,
      scope: 'POST' as const,
      postExternalId: raw.id,
      date: today,
      value,
      dataStatus: value === null ? ('UNAVAILABLE' as const) : ('READY' as const),
    };
  });
}
