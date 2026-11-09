-- CreateTable
CREATE TABLE "product_seo_check" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "url" TEXT NOT NULL,
    "finalUrl" TEXT,
    "status" INTEGER,
    "loadMs" INTEGER,
    "bytes" INTEGER,
    "error" TEXT,
    "metrics" JSONB,

    CONSTRAINT "product_seo_check_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "product_seo_check_productId_createdAt_idx" ON "product_seo_check"("productId", "createdAt");

-- AddForeignKey
ALTER TABLE "product_seo_check" ADD CONSTRAINT "product_seo_check_productId_fkey" FOREIGN KEY ("productId") REFERENCES "shop_product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

