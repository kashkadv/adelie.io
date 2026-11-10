-- AlterTable
ALTER TABLE "website_event" ADD COLUMN "userKey" TEXT;

-- CreateIndex
CREATE INDEX "website_event_siteId_userKey_idx" ON "website_event"("siteId", "userKey");
