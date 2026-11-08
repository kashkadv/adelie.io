-- Etsy shop snapshot metrics (ADR-0008). Separate migration: a new enum value can only be used
-- after the transaction that added it has committed.
INSERT INTO "metric_definition"
  ("platform", "scope", "key", "providerKey", "unit", "aggregation", "valueKind", "numeratorKey", "denominatorKey")
VALUES
  ('ETSY', 'ACCOUNT', 'sold_count',      'transaction_sold_count', 'COUNT', 'LAST', 'SNAPSHOT', NULL, NULL),
  ('ETSY', 'ACCOUNT', 'favorers',        'num_favorers',           'COUNT', 'LAST', 'SNAPSHOT', NULL, NULL),
  ('ETSY', 'ACCOUNT', 'reviews',         'review_count',           'COUNT', 'LAST', 'SNAPSHOT', NULL, NULL),
  ('ETSY', 'ACCOUNT', 'active_listings', 'listing_active_count',   'COUNT', 'LAST', 'SNAPSHOT', NULL, NULL);
