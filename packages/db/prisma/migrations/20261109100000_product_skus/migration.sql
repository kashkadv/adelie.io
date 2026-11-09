-- AlterTable
ALTER TABLE "shop_product" ADD COLUMN     "skus" TEXT[] DEFAULT ARRAY[]::TEXT[];
