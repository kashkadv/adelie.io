-- AlterTable
ALTER TABLE "shop_product" ADD COLUMN     "skuBy" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "skuGroups" INTEGER;
