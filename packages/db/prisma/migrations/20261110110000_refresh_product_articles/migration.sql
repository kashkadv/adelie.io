-- Data repair, no schema change: products whose SKU was saved from the editor before the articles
-- followed it ("00011512/1" → "00011512") get their articles recomputed from their SKUs.
UPDATE "shop_product"
SET "articles" = ARRAY(SELECT DISTINCT split_part(s, '/', 1) FROM unnest("skus") AS s WHERE s <> '')
WHERE "articles" IS DISTINCT FROM ARRAY(SELECT DISTINCT split_part(s, '/', 1) FROM unnest("skus") AS s WHERE s <> '');
