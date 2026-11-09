-- AlterTable
ALTER TABLE "tracked_site" ADD COLUMN "serverKeyHash" TEXT,
ADD COLUMN "serverKeyHint" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "tracked_site_serverKeyHash_key" ON "tracked_site"("serverKeyHash");
