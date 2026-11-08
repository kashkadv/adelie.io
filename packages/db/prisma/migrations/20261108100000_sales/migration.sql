-- Points of sale (ADR-0018): Etsy as a platform; shop products, orders and order lines.
ALTER TYPE "SocialPlatform" ADD VALUE 'ETSY';

CREATE TABLE "shop_product" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "externalId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "url" TEXT,
    "imageUrl" TEXT,
    "state" TEXT NOT NULL,
    "price" INTEGER,
    "currency" TEXT,
    "quantity" INTEGER,
    "views" INTEGER,
    "favorers" INTEGER,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "listedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shop_product_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "shop_order" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "externalId" TEXT NOT NULL,
    "orderedAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT,
    "isPaid" BOOLEAN,
    "isShipped" BOOLEAN,
    "currency" TEXT NOT NULL,
    "total" INTEGER,
    "subtotal" INTEGER,
    "shipping" INTEGER,
    "tax" INTEGER,
    "discount" INTEGER,
    "country" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shop_order_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "shop_order_item" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "productId" UUID,
    "externalId" TEXT NOT NULL,
    "productExternalId" TEXT,
    "title" TEXT,
    "quantity" INTEGER NOT NULL,
    "price" INTEGER,

    CONSTRAINT "shop_order_item_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "shop_product_accountId_externalId_key" ON "shop_product"("accountId", "externalId");
CREATE INDEX "shop_product_projectId_idx" ON "shop_product"("projectId");
CREATE UNIQUE INDEX "shop_order_accountId_externalId_key" ON "shop_order"("accountId", "externalId");
CREATE INDEX "shop_order_accountId_orderedAt_idx" ON "shop_order"("accountId", "orderedAt");
CREATE INDEX "shop_order_projectId_orderedAt_idx" ON "shop_order"("projectId", "orderedAt");
CREATE UNIQUE INDEX "shop_order_item_orderId_externalId_key" ON "shop_order_item"("orderId", "externalId");
CREATE INDEX "shop_order_item_productId_idx" ON "shop_order_item"("productId");

ALTER TABLE "shop_product" ADD CONSTRAINT "shop_product_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "social_account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "shop_order" ADD CONSTRAINT "shop_order_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "social_account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "shop_order_item" ADD CONSTRAINT "shop_order_item_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "shop_order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "shop_order_item" ADD CONSTRAINT "shop_order_item_productId_fkey" FOREIGN KEY ("productId") REFERENCES "shop_product"("id") ON DELETE SET NULL ON UPDATE CASCADE;
