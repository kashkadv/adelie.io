-- The owner's sketches of rooms in a location (owner, 2026-11-27).
-- CreateTable
CREATE TABLE "scene_sketch" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "locationId" UUID NOT NULL,
    "assetId" UUID NOT NULL,
    "sceneType" TEXT NOT NULL,
    "name" TEXT,
    "zone" JSONB,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scene_sketch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "scene_sketch_locationId_position_idx" ON "scene_sketch"("locationId", "position");

-- AddForeignKey
ALTER TABLE "scene_sketch" ADD CONSTRAINT "scene_sketch_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "scene_location"("id") ON DELETE CASCADE ON UPDATE CASCADE;
