-- Rooms are chosen per scene inside a location (a hotel, a chalet) - ADR-0042, owner 2026-11-26.
-- AlterTable
ALTER TABLE "scene" ADD COLUMN     "room" TEXT;

-- AlterTable
ALTER TABLE "scene_location" ALTER COLUMN "kind" SET DEFAULT 'other';
