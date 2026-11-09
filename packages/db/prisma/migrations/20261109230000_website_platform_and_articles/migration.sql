-- AlterEnum
ALTER TYPE "SocialPlatform" ADD VALUE 'WEBSITE';

-- AlterTable
ALTER TABLE "shop_product" ADD COLUMN     "articles" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- Existing products: the articles of their SKUs.
UPDATE "shop_product"
SET "articles" = ARRAY(SELECT DISTINCT split_part(s, '/', 1) FROM unnest("skus") AS s WHERE s <> '');
