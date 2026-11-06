-- Seed: more Pinterest pin metrics, confirmed on real data in PoC 2 (Gushka, 2026-11-06).
-- `pin_metrics.lifetime_metrics` keys are lowercase in the API; the adapter upper-cases them.
-- Video watch time (video_average_time, video_total_time) is left out until its unit is known.
INSERT INTO "metric_definition"
  ("platform", "scope", "key", "providerKey", "unit", "aggregation", "valueKind")
VALUES
  ('PINTEREST', 'POST', 'comments',        'COMMENT',         'COUNT', 'LAST', 'LIFETIME'),
  ('PINTEREST', 'POST', 'reactions',       'REACTION',        'COUNT', 'LAST', 'LIFETIME'),
  ('PINTEREST', 'POST', 'profile_visits',  'PROFILE_VISIT',   'COUNT', 'LAST', 'LIFETIME'),
  ('PINTEREST', 'POST', 'follows',         'USER_FOLLOW',     'COUNT', 'LAST', 'LIFETIME'),
  ('PINTEREST', 'POST', 'video_views',     'VIDEO_VIEWS',     'COUNT', 'LAST', 'LIFETIME'),
  ('PINTEREST', 'POST', 'video_10s_views', 'VIDEO_10S_VIEWS', 'COUNT', 'LAST', 'LIFETIME'),
  ('PINTEREST', 'POST', 'video_p95_views', 'VIDEO_P95_VIEWS', 'COUNT', 'LAST', 'LIFETIME')
ON CONFLICT DO NOTHING;
