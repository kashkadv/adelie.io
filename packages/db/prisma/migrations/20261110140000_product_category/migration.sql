-- AlterTable
ALTER TABLE "shop_product" ADD COLUMN     "category" TEXT;

-- Site products already synced: the category from their feed fields.
UPDATE "shop_product" SET "category" = NULLIF(BTRIM("details"->>'productType'), '') WHERE "details" IS NOT NULL;
