-- AlterTable
ALTER TABLE "shop_product" ADD COLUMN     "variationOptions" TEXT[] DEFAULT ARRAY[]::TEXT[];
