-- Audit of product changes made from Adelie (ADR-0019).
CREATE TABLE "shop_product_change" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "userId" TEXT,
    "changes" JSONB NOT NULL,
    "status" TEXT NOT NULL,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shop_product_change_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "shop_product_change_productId_createdAt_idx" ON "shop_product_change"("productId", "createdAt");

ALTER TABLE "shop_product_change" ADD CONSTRAINT "shop_product_change_productId_fkey" FOREIGN KEY ("productId") REFERENCES "shop_product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "shop_product_change" ADD CONSTRAINT "shop_product_change_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
