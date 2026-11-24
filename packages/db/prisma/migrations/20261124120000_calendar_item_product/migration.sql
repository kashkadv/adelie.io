-- The product a calendar item is about (ADR-0037).
ALTER TABLE "calendar_item" ADD COLUMN "productId" UUID;

ALTER TABLE "calendar_item"
  ADD CONSTRAINT "calendar_item_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "shop_product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "calendar_item_productId_idx" ON "calendar_item"("productId");
