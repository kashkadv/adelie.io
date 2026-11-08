-- Account audience snapshots: demographics and interests as the platform reports them.
CREATE TABLE "account_audience" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "size" INTEGER,
    "groups" JSONB NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "account_audience_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "account_audience_accountId_type_date_key" ON "account_audience"("accountId", "type", "date");

ALTER TABLE "account_audience" ADD CONSTRAINT "account_audience_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "social_account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
