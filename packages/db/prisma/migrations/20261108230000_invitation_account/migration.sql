-- An invitation can update access of a connected account (ADR-0020).
ALTER TABLE "connect_invitation" ADD COLUMN "accountId" UUID;
ALTER TABLE "connect_invitation" ADD CONSTRAINT "connect_invitation_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "social_account"("id") ON DELETE SET NULL ON UPDATE CASCADE;
