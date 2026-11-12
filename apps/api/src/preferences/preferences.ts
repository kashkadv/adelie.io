// Per-user interface settings (user_preference). Every key is known here and its value validated:
// nothing the client sends is stored as-is.

/** Content table columns each platform offers (PostMetricsLatest fields + the publication date). */
export const CONTENT_COLUMNS = {
  PINTEREST: ['impressions', 'saves', 'pinClicks', 'outboundClicks', 'videoViews', 'publishedAt'],
  INSTAGRAM: ['views', 'reach', 'likes', 'comments', 'saves', 'shares', 'publishedAt'],
  TIKTOK: ['views', 'likes', 'comments', 'shares', 'publishedAt'],
} as const;
type ContentPlatform = keyof typeof CONTENT_COLUMNS;

const COLUMNS_KEY = /^content\.columns\.(PINTEREST|INSTAGRAM|TIKTOK)$/;

export type PreferenceResult = { ok: true; value: unknown } | { ok: false; error: string };

export function isPreferenceKey(key: string): boolean {
  return COLUMNS_KEY.test(key);
}

/** Validates a setting's value for its key; returns the normalized value to store. */
export function parsePreference(key: string, value: unknown): PreferenceResult {
  const columns = COLUMNS_KEY.exec(key);
  if (!columns) return { ok: false, error: 'Unknown setting' };
  const allowed: readonly string[] = CONTENT_COLUMNS[columns[1] as ContentPlatform];
  const list = (value as { columns?: unknown } | null)?.columns;
  if (!Array.isArray(list) || list.length === 0) {
    return { ok: false, error: 'At least one column is required' };
  }
  if (!list.every((c): c is string => typeof c === 'string' && allowed.includes(c))) {
    return { ok: false, error: 'Unknown column' };
  }
  if (new Set(list).size !== list.length) return { ok: false, error: 'Duplicate column' };
  return { ok: true, value: { columns: list } };
}
