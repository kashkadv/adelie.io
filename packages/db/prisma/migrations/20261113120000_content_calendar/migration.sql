-- Content calendar and weekly review (ADR-0028): new tables and an optional project field only.
ALTER TABLE "project" ADD COLUMN "dailyMinutes" INTEGER;

CREATE TABLE "calendar_item" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "date" DATE,
    "position" INTEGER NOT NULL DEFAULT 0,
    "channel" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "notes" TEXT,
    "minutes" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'idea',
    "linkId" UUID,
    "postId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "calendar_item_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "weekly_review" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "weekStart" DATE NOT NULL,
    "notes" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "weekly_review_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "calendar_item_projectId_date_idx" ON "calendar_item"("projectId", "date");
CREATE UNIQUE INDEX "weekly_review_projectId_weekStart_key" ON "weekly_review"("projectId", "weekStart");

ALTER TABLE "calendar_item" ADD CONSTRAINT "calendar_item_linkId_fkey" FOREIGN KEY ("linkId") REFERENCES "tracked_link"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "calendar_item" ADD CONSTRAINT "calendar_item_postId_fkey" FOREIGN KEY ("postId") REFERENCES "social_post"("id") ON DELETE SET NULL ON UPDATE CASCADE;
