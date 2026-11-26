-- Scene library (ADR-0042): files, the GPU worker and its jobs (ADR-0041), scene locations and scenes.
-- CreateTable
CREATE TABLE "asset" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "role" TEXT NOT NULL,
    "origin" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "bytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "parentId" UUID,
    "recipe" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "asset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gpu_worker" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "keyPrefix" TEXT NOT NULL,
    "lastSeenAt" TIMESTAMP(3),
    "state" TEXT,
    "vramFreeMb" INTEGER,
    "info" JSONB,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gpu_worker_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gpu_job" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "params" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "workerId" UUID,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "claimedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "gpu_job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scene_location" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'living',
    "description" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "scene_location_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scene" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "locationId" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'candidate',
    "name" TEXT,
    "number" INTEGER NOT NULL DEFAULT 1,
    "style" TEXT,
    "light" TEXT,
    "angle" TEXT,
    "sizeClass" TEXT,
    "placement" TEXT NOT NULL DEFAULT 'floor',
    "productTypes" TEXT[],
    "tags" TEXT[],
    "minCm" INTEGER,
    "maxCm" INTEGER,
    "params" JSONB NOT NULL,
    "assetId" UUID,
    "jobId" UUID,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "scene_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "asset_projectId_role_idx" ON "asset"("projectId", "role");

-- CreateIndex
CREATE INDEX "asset_sha256_idx" ON "asset"("sha256");

-- CreateIndex
CREATE UNIQUE INDEX "gpu_worker_keyHash_key" ON "gpu_worker"("keyHash");

-- CreateIndex
CREATE INDEX "gpu_worker_workspaceId_idx" ON "gpu_worker"("workspaceId");

-- CreateIndex
CREATE INDEX "gpu_job_status_createdAt_idx" ON "gpu_job"("status", "createdAt");

-- CreateIndex
CREATE INDEX "gpu_job_projectId_createdAt_idx" ON "gpu_job"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "scene_location_projectId_position_idx" ON "scene_location"("projectId", "position");

-- CreateIndex
CREATE INDEX "scene_projectId_status_idx" ON "scene"("projectId", "status");

-- CreateIndex
CREATE INDEX "scene_locationId_status_idx" ON "scene"("locationId", "status");

-- AddForeignKey
ALTER TABLE "gpu_job" ADD CONSTRAINT "gpu_job_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "gpu_worker"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scene" ADD CONSTRAINT "scene_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "scene_location"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scene" ADD CONSTRAINT "scene_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "gpu_job"("id") ON DELETE SET NULL ON UPDATE CASCADE;
