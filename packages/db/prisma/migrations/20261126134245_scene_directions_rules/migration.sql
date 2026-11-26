-- Scene library v2 (ADR-0042, owner 2026-11-26): location direction, must-haves, cover, archive; editable prompt rules.
-- AlterTable
ALTER TABLE "scene_location" ADD COLUMN     "archivedAt" TIMESTAMP(3),
ADD COLUMN     "coverSceneId" UUID,
ADD COLUMN     "direction" TEXT NOT NULL DEFAULT 'interior',
ADD COLUMN     "mustHave" TEXT;

-- CreateTable
CREATE TABLE "scene_rule" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "direction" TEXT,
    "label" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "mockup" JSONB,
    "builtIn" BOOLEAN NOT NULL DEFAULT false,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "scene_rule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "scene_rule_projectId_key_key" ON "scene_rule"("projectId", "key");
