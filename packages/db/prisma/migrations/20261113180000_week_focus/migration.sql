-- Week focus and AI proposals with a day (ADR-0030). A new table and field only.
ALTER TABLE "calendar_item" ADD COLUMN "suggestion" TEXT;

CREATE TABLE "calendar_week" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "weekStart" DATE NOT NULL,
    "focus" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "calendar_week_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "calendar_week_projectId_weekStart_key" ON "calendar_week"("projectId", "weekStart");
