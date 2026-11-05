-- CreateEnum
CREATE TYPE "SocialPlatform" AS ENUM ('PINTEREST', 'INSTAGRAM', 'TIKTOK');

-- CreateEnum
CREATE TYPE "ConnectionStatus" AS ENUM ('ACTIVE', 'REAUTHORIZATION_REQUIRED', 'REVOKED');

-- CreateEnum
CREATE TYPE "PostContentType" AS ENUM ('IMAGE', 'VIDEO', 'CAROUSEL', 'PRODUCT', 'OTHER');

-- CreateEnum
CREATE TYPE "MetricScope" AS ENUM ('ACCOUNT', 'POST');

-- CreateEnum
CREATE TYPE "MetricUnit" AS ENUM ('COUNT', 'RATE', 'SECONDS');

-- CreateEnum
CREATE TYPE "MetricAggregation" AS ENUM ('SUM', 'AVG', 'LAST', 'RATIO', 'NONE');

-- CreateEnum
CREATE TYPE "MetricValueKind" AS ENUM ('DAILY', 'LIFETIME', 'PERIOD', 'SNAPSHOT');

-- CreateEnum
CREATE TYPE "DataStatus" AS ENUM ('READY', 'PROCESSING', 'ESTIMATE', 'UNAVAILABLE');

-- CreateEnum
CREATE TYPE "SyncKind" AS ENUM ('INITIAL', 'DAILY', 'MANUAL', 'RETRY');

-- CreateEnum
CREATE TYPE "SyncStatus" AS ENUM ('PENDING', 'RUNNING', 'SUCCESS', 'PARTIAL', 'FAILED', 'REAUTHORIZATION_REQUIRED');

-- AlterEnum
ALTER TYPE "WorkspaceRole" ADD VALUE 'MANAGER';

-- CreateTable
CREATE TABLE "project" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "reportLocale" TEXT NOT NULL DEFAULT 'en',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_member" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "memberId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_member_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "social_connection" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "platform" "SocialPlatform" NOT NULL,
    "externalUserId" TEXT NOT NULL,
    "scopes" TEXT[],
    "accessTokenEncrypted" TEXT NOT NULL,
    "refreshTokenEncrypted" TEXT,
    "keyVersion" INTEGER NOT NULL DEFAULT 1,
    "accessTokenExpiresAt" TIMESTAMP(3),
    "refreshTokenExpiresAt" TIMESTAMP(3),
    "status" "ConnectionStatus" NOT NULL DEFAULT 'ACTIVE',
    "connectedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "social_connection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "social_account" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "connectionId" UUID NOT NULL,
    "platform" "SocialPlatform" NOT NULL,
    "externalId" TEXT NOT NULL,
    "username" TEXT,
    "displayName" TEXT,
    "avatarUrl" TEXT,
    "accountType" TEXT,
    "followersCount" INTEGER,
    "followingCount" INTEGER,
    "postsCount" INTEGER,
    "historyAvailableFrom" DATE,
    "collectingSince" DATE,
    "lastSyncedAt" TIMESTAMP(3),
    "lastSuccessfulSyncAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "social_account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "social_board" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "externalId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "privacy" TEXT,
    "pinCount" INTEGER,
    "coverUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "social_board_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "social_post" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "boardId" UUID,
    "externalId" TEXT NOT NULL,
    "url" TEXT,
    "contentType" "PostContentType" NOT NULL DEFAULT 'OTHER',
    "title" TEXT,
    "description" TEXT,
    "thumbnailUrl" TEXT,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "social_post_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "metric_definition" (
    "id" SERIAL NOT NULL,
    "platform" "SocialPlatform" NOT NULL,
    "scope" "MetricScope" NOT NULL,
    "key" TEXT NOT NULL,
    "providerKey" TEXT NOT NULL,
    "unit" "MetricUnit" NOT NULL,
    "aggregation" "MetricAggregation" NOT NULL,
    "valueKind" "MetricValueKind" NOT NULL,
    "numeratorKey" TEXT,
    "denominatorKey" TEXT,

    CONSTRAINT "metric_definition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account_metric_value" (
    "id" BIGSERIAL NOT NULL,
    "workspaceId" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "metricId" INTEGER NOT NULL,
    "date" DATE NOT NULL,
    "dimensionKey" TEXT NOT NULL DEFAULT '',
    "value" DOUBLE PRECISION,
    "dataStatus" "DataStatus" NOT NULL,
    "providerStatus" TEXT,
    "source" TEXT NOT NULL,
    "apiVersion" TEXT NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "account_metric_value_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "post_metric_value" (
    "id" BIGSERIAL NOT NULL,
    "workspaceId" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "postId" UUID NOT NULL,
    "metricId" INTEGER NOT NULL,
    "date" DATE NOT NULL,
    "dimensionKey" TEXT NOT NULL DEFAULT '',
    "value" DOUBLE PRECISION,
    "dataStatus" "DataStatus" NOT NULL,
    "providerStatus" TEXT,
    "source" TEXT NOT NULL,
    "apiVersion" TEXT NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "post_metric_value_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "post_metrics_latest" (
    "postId" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "boardId" UUID,
    "impressions" INTEGER,
    "saves" INTEGER,
    "pinClicks" INTEGER,
    "outboundClicks" INTEGER,
    "engagements" INTEGER,
    "videoViews" INTEGER,
    "engagementRate" DOUBLE PRECISION,
    "dataStatus" "DataStatus" NOT NULL,
    "asOfDate" DATE NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "post_metrics_latest_pkey" PRIMARY KEY ("postId")
);

-- CreateTable
CREATE TABLE "sync_run" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "connectionId" UUID NOT NULL,
    "accountId" UUID,
    "kind" "SyncKind" NOT NULL,
    "status" "SyncStatus" NOT NULL DEFAULT 'PENDING',
    "correlationId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "requestCount" INTEGER NOT NULL DEFAULT 0,
    "stats" JSONB,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sync_run_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_payload" (
    "id" BIGSERIAL NOT NULL,
    "workspaceId" UUID NOT NULL,
    "syncRunId" UUID NOT NULL,
    "endpoint" TEXT NOT NULL,
    "params" JSONB,
    "httpStatus" INTEGER NOT NULL,
    "body" JSONB NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sync_payload_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "project_workspaceId_idx" ON "project"("workspaceId");

-- CreateIndex
CREATE INDEX "project_member_memberId_idx" ON "project_member"("memberId");

-- CreateIndex
CREATE UNIQUE INDEX "project_member_projectId_memberId_key" ON "project_member"("projectId", "memberId");

-- CreateIndex
CREATE INDEX "social_connection_projectId_idx" ON "social_connection"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "social_connection_workspaceId_platform_externalUserId_key" ON "social_connection"("workspaceId", "platform", "externalUserId");

-- CreateIndex
CREATE INDEX "social_account_projectId_idx" ON "social_account"("projectId");

-- CreateIndex
CREATE INDEX "social_account_connectionId_idx" ON "social_account"("connectionId");

-- CreateIndex
CREATE UNIQUE INDEX "social_account_workspaceId_platform_externalId_key" ON "social_account"("workspaceId", "platform", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "social_board_accountId_externalId_key" ON "social_board"("accountId", "externalId");

-- CreateIndex
CREATE INDEX "social_post_accountId_publishedAt_idx" ON "social_post"("accountId", "publishedAt");

-- CreateIndex
CREATE INDEX "social_post_boardId_idx" ON "social_post"("boardId");

-- CreateIndex
CREATE UNIQUE INDEX "social_post_accountId_externalId_key" ON "social_post"("accountId", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "metric_definition_platform_scope_key_key" ON "metric_definition"("platform", "scope", "key");

-- CreateIndex
CREATE UNIQUE INDEX "metric_definition_platform_scope_providerKey_key" ON "metric_definition"("platform", "scope", "providerKey");

-- CreateIndex
CREATE INDEX "account_metric_value_workspaceId_idx" ON "account_metric_value"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "account_metric_value_accountId_metricId_date_dimensionKey_key" ON "account_metric_value"("accountId", "metricId", "date", "dimensionKey");

-- CreateIndex
CREATE INDEX "post_metric_value_accountId_idx" ON "post_metric_value"("accountId");

-- CreateIndex
CREATE INDEX "post_metric_value_workspaceId_idx" ON "post_metric_value"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "post_metric_value_postId_metricId_date_dimensionKey_key" ON "post_metric_value"("postId", "metricId", "date", "dimensionKey");

-- CreateIndex
CREATE INDEX "post_metrics_latest_accountId_idx" ON "post_metrics_latest"("accountId");

-- CreateIndex
CREATE INDEX "post_metrics_latest_projectId_idx" ON "post_metrics_latest"("projectId");

-- CreateIndex
CREATE INDEX "post_metrics_latest_boardId_idx" ON "post_metrics_latest"("boardId");

-- CreateIndex
CREATE INDEX "sync_run_connectionId_createdAt_idx" ON "sync_run"("connectionId", "createdAt");

-- CreateIndex
CREATE INDEX "sync_run_accountId_createdAt_idx" ON "sync_run"("accountId", "createdAt");

-- CreateIndex
CREATE INDEX "sync_run_workspaceId_idx" ON "sync_run"("workspaceId");

-- CreateIndex
CREATE INDEX "sync_payload_syncRunId_idx" ON "sync_payload"("syncRunId");

-- CreateIndex
CREATE INDEX "sync_payload_fetchedAt_idx" ON "sync_payload"("fetchedAt");

-- AddForeignKey
ALTER TABLE "project" ADD CONSTRAINT "project_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_member" ADD CONSTRAINT "project_member_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_member" ADD CONSTRAINT "project_member_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "workspace_member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "social_connection" ADD CONSTRAINT "social_connection_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "social_connection" ADD CONSTRAINT "social_connection_connectedByUserId_fkey" FOREIGN KEY ("connectedByUserId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "social_account" ADD CONSTRAINT "social_account_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "social_account" ADD CONSTRAINT "social_account_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "social_connection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "social_board" ADD CONSTRAINT "social_board_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "social_account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "social_post" ADD CONSTRAINT "social_post_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "social_account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "social_post" ADD CONSTRAINT "social_post_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "social_board"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_metric_value" ADD CONSTRAINT "account_metric_value_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "social_account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_metric_value" ADD CONSTRAINT "account_metric_value_metricId_fkey" FOREIGN KEY ("metricId") REFERENCES "metric_definition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "post_metric_value" ADD CONSTRAINT "post_metric_value_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "social_account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "post_metric_value" ADD CONSTRAINT "post_metric_value_postId_fkey" FOREIGN KEY ("postId") REFERENCES "social_post"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "post_metric_value" ADD CONSTRAINT "post_metric_value_metricId_fkey" FOREIGN KEY ("metricId") REFERENCES "metric_definition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "post_metrics_latest" ADD CONSTRAINT "post_metrics_latest_postId_fkey" FOREIGN KEY ("postId") REFERENCES "social_post"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "post_metrics_latest" ADD CONSTRAINT "post_metrics_latest_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "social_account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sync_run" ADD CONSTRAINT "sync_run_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "social_connection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sync_run" ADD CONSTRAINT "sync_run_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "social_account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sync_payload" ADD CONSTRAINT "sync_payload_syncRunId_fkey" FOREIGN KEY ("syncRunId") REFERENCES "sync_run"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Data: every existing workspace gets a first project with its settings (ADR-0007).
INSERT INTO "project" ("id", "workspaceId", "name", "timezone", "currency", "updatedAt")
SELECT uuidv7(), "id", "name", "timezone", "currency", CURRENT_TIMESTAMP FROM "workspace";

-- AlterTable: project-level settings replace workspace-level ones.
ALTER TABLE "workspace" DROP COLUMN "currency",
DROP COLUMN "timezone";

-- Seed: Pinterest metric catalogue (ADR-0008). Pin metrics to be extended after PoC 2.
INSERT INTO "metric_definition"
  ("platform", "scope", "key", "providerKey", "unit", "aggregation", "valueKind", "numeratorKey", "denominatorKey")
VALUES
  ('PINTEREST', 'ACCOUNT', 'impressions',         'IMPRESSION',          'COUNT', 'SUM',   'DAILY',    NULL,              NULL),
  ('PINTEREST', 'ACCOUNT', 'engagements',         'ENGAGEMENT',          'COUNT', 'SUM',   'DAILY',    NULL,              NULL),
  ('PINTEREST', 'ACCOUNT', 'engagement_rate',     'ENGAGEMENT_RATE',     'RATE',  'RATIO', 'DAILY',    'engagements',     'impressions'),
  ('PINTEREST', 'ACCOUNT', 'pin_clicks',          'PIN_CLICK',           'COUNT', 'SUM',   'DAILY',    NULL,              NULL),
  ('PINTEREST', 'ACCOUNT', 'pin_click_rate',      'PIN_CLICK_RATE',      'RATE',  'RATIO', 'DAILY',    'pin_clicks',      'impressions'),
  ('PINTEREST', 'ACCOUNT', 'outbound_clicks',     'OUTBOUND_CLICK',      'COUNT', 'SUM',   'DAILY',    NULL,              NULL),
  ('PINTEREST', 'ACCOUNT', 'outbound_click_rate', 'OUTBOUND_CLICK_RATE', 'RATE',  'RATIO', 'DAILY',    'outbound_clicks', 'impressions'),
  ('PINTEREST', 'ACCOUNT', 'saves',               'SAVE',                'COUNT', 'SUM',   'DAILY',    NULL,              NULL),
  ('PINTEREST', 'ACCOUNT', 'save_rate',           'SAVE_RATE',           'RATE',  'RATIO', 'DAILY',    'saves',           'impressions'),
  ('PINTEREST', 'ACCOUNT', 'followers',           'follower_count',      'COUNT', 'LAST',  'SNAPSHOT', NULL,              NULL),
  ('PINTEREST', 'ACCOUNT', 'monthly_views',       'monthly_views',       'COUNT', 'LAST',  'SNAPSHOT', NULL,              NULL),
  ('PINTEREST', 'POST',    'impressions',         'IMPRESSION',          'COUNT', 'LAST',  'LIFETIME', NULL,              NULL),
  ('PINTEREST', 'POST',    'saves',               'SAVE',                'COUNT', 'LAST',  'LIFETIME', NULL,              NULL),
  ('PINTEREST', 'POST',    'pin_clicks',          'PIN_CLICK',           'COUNT', 'LAST',  'LIFETIME', NULL,              NULL),
  ('PINTEREST', 'POST',    'outbound_clicks',     'OUTBOUND_CLICK',      'COUNT', 'LAST',  'LIFETIME', NULL,              NULL);
