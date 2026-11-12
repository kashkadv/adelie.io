-- Project brief, AI suggestions in the calendar, the AI request log (ADR-0029). New fields and a new table only.
ALTER TABLE "project" ADD COLUMN "brief" JSONB;

ALTER TABLE "calendar_item" ADD COLUMN "why" TEXT,
ADD COLUMN "evidence" TEXT,
ADD COLUMN "aiRunId" UUID;

CREATE TABLE "ai_run" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "userId" TEXT,
    "kind" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "cachedTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "costMicros" INTEGER NOT NULL DEFAULT 0,
    "input" JSONB NOT NULL,
    "output" JSONB,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_run_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ai_run_projectId_createdAt_idx" ON "ai_run"("projectId", "createdAt");
