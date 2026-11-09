-- AlterTable
ALTER TABLE "project" ADD COLUMN     "accountOrder" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "social_account" ADD COLUMN     "displayNameCustom" BOOLEAN NOT NULL DEFAULT false;

-- A site's name is the one its member typed when connecting it.
UPDATE "social_account" SET "displayNameCustom" = true WHERE "platform" = 'WEBSITE';
