-- AlterTable: Instagram post metrics in the wide "latest" table.
ALTER TABLE "post_metrics_latest" ADD COLUMN "views" INTEGER,
ADD COLUMN "reach" INTEGER,
ADD COLUMN "likes" INTEGER,
ADD COLUMN "comments" INTEGER,
ADD COLUMN "shares" INTEGER;

-- Seed: Instagram metric catalogue (ADR-0008, docs/integrations/instagram.md).
-- reach / accounts_engaged count unique accounts: daily values must not be summed (NONE).
INSERT INTO "metric_definition"
  ("platform", "scope", "key", "providerKey", "unit", "aggregation", "valueKind", "numeratorKey", "denominatorKey")
VALUES
  ('INSTAGRAM', 'ACCOUNT', 'views',              'views',              'COUNT', 'SUM',  'DAILY',    NULL, NULL),
  ('INSTAGRAM', 'ACCOUNT', 'reach',              'reach',              'COUNT', 'NONE', 'DAILY',    NULL, NULL),
  ('INSTAGRAM', 'ACCOUNT', 'accounts_engaged',   'accounts_engaged',   'COUNT', 'NONE', 'DAILY',    NULL, NULL),
  ('INSTAGRAM', 'ACCOUNT', 'engagements',        'total_interactions', 'COUNT', 'SUM',  'DAILY',    NULL, NULL),
  ('INSTAGRAM', 'ACCOUNT', 'likes',              'likes',              'COUNT', 'SUM',  'DAILY',    NULL, NULL),
  ('INSTAGRAM', 'ACCOUNT', 'comments',           'comments',           'COUNT', 'SUM',  'DAILY',    NULL, NULL),
  ('INSTAGRAM', 'ACCOUNT', 'saves',              'saves',              'COUNT', 'SUM',  'DAILY',    NULL, NULL),
  ('INSTAGRAM', 'ACCOUNT', 'shares',             'shares',             'COUNT', 'SUM',  'DAILY',    NULL, NULL),
  ('INSTAGRAM', 'ACCOUNT', 'profile_link_taps',  'profile_links_taps', 'COUNT', 'SUM',  'DAILY',    NULL, NULL),
  ('INSTAGRAM', 'ACCOUNT', 'new_followers',      'follower_count',     'COUNT', 'SUM',  'DAILY',    NULL, NULL),
  ('INSTAGRAM', 'ACCOUNT', 'followers',          'followers_count',    'COUNT', 'LAST', 'SNAPSHOT', NULL, NULL),
  ('INSTAGRAM', 'POST',    'views',              'views',              'COUNT', 'LAST', 'LIFETIME', NULL, NULL),
  ('INSTAGRAM', 'POST',    'reach',              'reach',              'COUNT', 'LAST', 'LIFETIME', NULL, NULL),
  ('INSTAGRAM', 'POST',    'likes',              'likes',              'COUNT', 'LAST', 'LIFETIME', NULL, NULL),
  ('INSTAGRAM', 'POST',    'comments',           'comments',           'COUNT', 'LAST', 'LIFETIME', NULL, NULL),
  ('INSTAGRAM', 'POST',    'saves',              'saved',              'COUNT', 'LAST', 'LIFETIME', NULL, NULL),
  ('INSTAGRAM', 'POST',    'shares',             'shares',             'COUNT', 'LAST', 'LIFETIME', NULL, NULL),
  ('INSTAGRAM', 'POST',    'engagements',        'total_interactions', 'COUNT', 'LAST', 'LIFETIME', NULL, NULL);
