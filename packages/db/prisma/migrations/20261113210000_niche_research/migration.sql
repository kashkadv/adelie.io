-- Niche research (ADR-0032): new tables and optional project fields only.
ALTER TABLE "project" ADD COLUMN "markets" JSONB,
ADD COLUMN "deliveryDays" INTEGER;

CREATE TABLE "research" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "keywords" TEXT[],
    "salesAccountId" UUID NOT NULL,
    "channel" TEXT NOT NULL,
    "productIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "directionId" TEXT,
    "endsOn" DATE,
    "context" JSONB,
    "refreshedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "research_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "research_snapshot" (
    "id" UUID NOT NULL,
    "researchId" UUID NOT NULL,
    "source" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "error" TEXT,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "research_snapshot_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "research_projectId_idx" ON "research"("projectId");
CREATE UNIQUE INDEX "research_snapshot_researchId_source_key" ON "research_snapshot"("researchId", "source");

ALTER TABLE "research_snapshot" ADD CONSTRAINT "research_snapshot_researchId_fkey" FOREIGN KEY ("researchId") REFERENCES "research"("id") ON DELETE CASCADE ON UPDATE CASCADE;
