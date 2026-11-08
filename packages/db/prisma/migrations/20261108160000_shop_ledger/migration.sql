-- Shop payment-account ledger (Etsy): fees, refunds, taxes, ads, payouts (ADR-0018).
CREATE TABLE "shop_ledger_entry" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "externalId" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "type" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "referenceType" TEXT,
    "referenceId" TEXT,
    "amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,

    CONSTRAINT "shop_ledger_entry_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "shop_ledger_entry_accountId_externalId_key" ON "shop_ledger_entry"("accountId", "externalId");
CREATE INDEX "shop_ledger_entry_projectId_occurredAt_idx" ON "shop_ledger_entry"("projectId", "occurredAt");

ALTER TABLE "shop_ledger_entry" ADD CONSTRAINT "shop_ledger_entry_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "social_account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
