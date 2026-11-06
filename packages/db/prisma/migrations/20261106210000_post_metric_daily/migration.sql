-- AlterTable
ALTER TABLE "social_post" ADD COLUMN     "dailyFrom" DATE,
ADD COLUMN     "dailyTo" DATE;

-- CreateTable
CREATE TABLE "post_metric_daily" (
    "postId" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "metricId" INTEGER NOT NULL,
    "date" DATE NOT NULL,
    "value" DOUBLE PRECISION,
    "dataStatus" "DataStatus" NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "post_metric_daily_pkey" PRIMARY KEY ("postId","metricId","date")
);

-- CreateIndex
CREATE INDEX "post_metric_daily_accountId_date_idx" ON "post_metric_daily"("accountId", "date");

-- CreateIndex
CREATE INDEX "post_metric_daily_workspaceId_idx" ON "post_metric_daily"("workspaceId");

-- AddForeignKey
ALTER TABLE "post_metric_daily" ADD CONSTRAINT "post_metric_daily_postId_fkey" FOREIGN KEY ("postId") REFERENCES "social_post"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "post_metric_daily" ADD CONSTRAINT "post_metric_daily_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "social_account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "post_metric_daily" ADD CONSTRAINT "post_metric_daily_metricId_fkey" FOREIGN KEY ("metricId") REFERENCES "metric_definition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
