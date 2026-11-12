-- Link Builder (ADR-0027): tracked links and the clicks on their short form. New tables only.
CREATE TABLE "tracked_link" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT,
    "destination" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "medium" TEXT NOT NULL,
    "campaign" TEXT,
    "content" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "tracked_link_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "link_click" (
    "id" UUID NOT NULL,
    "linkId" UUID NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "referrerHost" TEXT,
    "country" TEXT,
    "device" TEXT,
    "isBot" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "link_click_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "tracked_link_code_key" ON "tracked_link"("code");
CREATE INDEX "tracked_link_projectId_idx" ON "tracked_link"("projectId");
CREATE INDEX "link_click_linkId_occurredAt_idx" ON "link_click"("linkId", "occurredAt");

ALTER TABLE "link_click" ADD CONSTRAINT "link_click_linkId_fkey" FOREIGN KEY ("linkId") REFERENCES "tracked_link"("id") ON DELETE CASCADE ON UPDATE CASCADE;
