-- AlterTable
ALTER TABLE "shop_product" ADD COLUMN     "twinGroupId" UUID;

-- CreateTable
CREATE TABLE "shop_product_issue_ignore" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shop_product_issue_ignore_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "shop_product_issue_ignore_productId_code_key" ON "shop_product_issue_ignore"("productId", "code");

-- CreateIndex
CREATE INDEX "shop_product_projectId_twinGroupId_idx" ON "shop_product"("projectId", "twinGroupId");

-- AddForeignKey
ALTER TABLE "shop_product_issue_ignore" ADD CONSTRAINT "shop_product_issue_ignore_productId_fkey" FOREIGN KEY ("productId") REFERENCES "shop_product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
