-- A product's counters by day (ADR-0036). The days already synced are rebuilt from the stored raw
-- Etsy responses (shop listings pages): the highest value seen on a day per listing.
CREATE TABLE "shop_product_daily" (
    "productId" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "date" DATE NOT NULL,
    "views" INTEGER,
    "favorers" INTEGER,

    CONSTRAINT "shop_product_daily_pkey" PRIMARY KEY ("productId","date")
);

CREATE INDEX "shop_product_daily_accountId_date_idx" ON "shop_product_daily"("accountId", "date");

INSERT INTO "shop_product_daily" ("productId", "accountId", "date", "views", "favorers")
SELECT sp."id", sp."accountId", (p."fetchedAt" AT TIME ZONE 'UTC')::date,
       max((x->>'views')::int), max((x->>'num_favorers')::int)
FROM "sync_payload" p
JOIN "sync_run" r ON r."id" = p."syncRunId"
JOIN "social_account" a ON a."id" = r."accountId" AND a."platform" = 'ETSY'
CROSS JOIN LATERAL jsonb_array_elements(
  CASE WHEN jsonb_typeof(p."body"->'results') = 'array' THEN p."body"->'results' ELSE '[]'::jsonb END
) x
JOIN "shop_product" sp ON sp."accountId" = a."id" AND sp."externalId" = x->>'listing_id'
WHERE p."endpoint" LIKE '/v3/application/shops/%/listings%'
  AND x->>'views' ~ '^[0-9]+$'
GROUP BY 1, 2, 3
ON CONFLICT DO NOTHING;
