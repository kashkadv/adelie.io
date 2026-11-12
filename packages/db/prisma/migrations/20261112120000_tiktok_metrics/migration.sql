-- Seed: TikTok metric catalogue (ADR-0023). The Display API gives lifetime totals only: video
-- counters are LIFETIME (daily values come from snapshot differences, ADR-0017), the profile's
-- counters are SNAPSHOT.
INSERT INTO "metric_definition"
  ("platform", "scope", "key", "providerKey", "unit", "aggregation", "valueKind", "numeratorKey", "denominatorKey")
VALUES
  ('TIKTOK', 'ACCOUNT', 'followers',   'follower_count', 'COUNT', 'LAST', 'SNAPSHOT', NULL, NULL),
  ('TIKTOK', 'ACCOUNT', 'likes_total', 'likes_count',    'COUNT', 'LAST', 'SNAPSHOT', NULL, NULL),
  ('TIKTOK', 'ACCOUNT', 'videos',      'video_count',    'COUNT', 'LAST', 'SNAPSHOT', NULL, NULL),
  ('TIKTOK', 'POST',    'views',       'view_count',     'COUNT', 'LAST', 'LIFETIME', NULL, NULL),
  ('TIKTOK', 'POST',    'likes',       'like_count',     'COUNT', 'LAST', 'LIFETIME', NULL, NULL),
  ('TIKTOK', 'POST',    'comments',    'comment_count',  'COUNT', 'LAST', 'LIFETIME', NULL, NULL),
  ('TIKTOK', 'POST',    'shares',      'share_count',    'COUNT', 'LAST', 'LIFETIME', NULL, NULL);
