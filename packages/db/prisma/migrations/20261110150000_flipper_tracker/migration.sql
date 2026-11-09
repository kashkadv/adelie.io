-- CreateTable
CREATE TABLE "tracked_site" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "publicId" TEXT NOT NULL,
    "allowedHosts" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tracked_site_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "website_event" (
    "id" UUID NOT NULL,
    "siteId" UUID NOT NULL,
    "eventId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "consent" BOOLEAN NOT NULL,
    "visitorId" TEXT,
    "sessionId" TEXT,
    "dailyId" TEXT,
    "url" TEXT NOT NULL,
    "title" TEXT,
    "referrerHost" TEXT,
    "source" TEXT,
    "medium" TEXT,
    "campaign" TEXT,
    "content" TEXT,
    "term" TEXT,
    "clickIdType" TEXT,
    "channel" TEXT,
    "device" TEXT,
    "isBot" BOOLEAN NOT NULL DEFAULT false,
    "properties" JSONB,

    CONSTRAINT "website_event_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tracked_site_accountId_key" ON "tracked_site"("accountId");

-- CreateIndex
CREATE UNIQUE INDEX "tracked_site_publicId_key" ON "tracked_site"("publicId");

-- CreateIndex
CREATE INDEX "tracked_site_projectId_idx" ON "tracked_site"("projectId");

-- CreateIndex
CREATE INDEX "website_event_siteId_occurredAt_idx" ON "website_event"("siteId", "occurredAt");

-- CreateIndex
CREATE INDEX "website_event_siteId_name_occurredAt_idx" ON "website_event"("siteId", "name", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "website_event_siteId_eventId_key" ON "website_event"("siteId", "eventId");

-- AddForeignKey
ALTER TABLE "tracked_site" ADD CONSTRAINT "tracked_site_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "social_account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "website_event" ADD CONSTRAINT "website_event_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "tracked_site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

